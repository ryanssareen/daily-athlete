// StravaOAuthService — handles the full Strava OAuth PKCE flow for Flutter.
//
// Flow (mirrors apps/mobile/src/integrations/strava.tsx):
// 1. POST /api/integrations/strava/init (Bearer) → { state }  (HMAC-signed nonce)
// 2. Generate PKCE: 32–48 random bytes → base64url → 43–64 char code_verifier.
//    SHA-256(code_verifier) → base64url → code_challenge.
//    RFC 7636 max code_verifier length is 128 chars; 256 bytes → 344-char string
//    that Strava REJECTS. Stay within 43–64 chars.
// 3. Register with StravaDeepLinkBridge BEFORE launching the browser.
// 4. url_launcher with LaunchMode.externalApplication — Strava ToS PROHIBITS webview.
// 5. Handle da2://strava-oauth?code=...&state=... from StravaDeepLinkBridge.
// 6. POST /api/integrations/strava/connect (Bearer) with
//    { code, code_verifier, redirect_uri, state }.
// 7. Resolve the pending Future with the HTTP status.

import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import '../../core/env.dart';
import '../../features/auth/auth_notifier.dart';
import '../../features/auth/deep_link_handler.dart';

// Strava OAuth scopes required for full activity sync.
const _stravaScopes = 'activity:read,activity:read_all,profile:read_all';

// Mobile redirect URI for the Strava OAuth hop.
//
// Strava allows only ONE Authorization Callback Domain per app, and the
// DA2 OAuth app's domain is `da2-one.vercel.app` (the web hostname). We
// therefore route the OAuth response through a stateless bounce on that
// domain, which 302s back to the `da2://strava-oauth` deep link the
// Flutter app already listens for via DeepLinkHandler.
//
//   Strava authorize → ${API_BASE_URL}/api/integrations/strava/mobile-bounce
//                    → 302 da2://strava-oauth?code=…&state=…
//                    → app_links → StravaDeepLinkBridge
//
// This is sent verbatim as `redirect_uri` to both Strava's authorize
// endpoint AND POST /api/integrations/strava/connect — Strava verifies
// they match on the token exchange. See docs/solutions/strava-oauth.md.
final _redirectUri =
    '${Env.apiBaseUrl}/api/integrations/strava/mobile-bounce';

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/// Generates a 43–64 character base64url code_verifier.
///
/// RFC 7636 §4.1: code_verifier is 43–128 chars from [A-Za-z0-9\-._~].
/// We generate 32 random bytes → 43-char base64url string (fits easily).
/// Do NOT use 256 bytes: that produces a 344-char string Strava rejects.
@visibleForTesting
String generateCodeVerifier({Random? random}) {
  final rng = random ?? Random.secure();
  // 32 bytes → ceil(32 * 4/3) = 44 base64 chars → strip trailing '=' → 43 chars.
  final bytes = Uint8List(32);
  for (var i = 0; i < bytes.length; i++) {
    bytes[i] = rng.nextInt(256);
  }
  return _base64urlNoPad(bytes);
}

/// SHA-256 of code_verifier → base64url (no padding) = code_challenge.
@visibleForTesting
String deriveCodeChallenge(String codeVerifier) {
  final digest = sha256.convert(utf8.encode(codeVerifier));
  return _base64urlNoPad(Uint8List.fromList(digest.bytes));
}

String _base64urlNoPad(Uint8List bytes) {
  return base64Url.encode(bytes).replaceAll('=', '');
}

// ---------------------------------------------------------------------------
// Service state
// ---------------------------------------------------------------------------

enum StravaConnectionStatus {
  /// No Strava token row — disconnected.
  notConnected,

  /// Browser opened, waiting for deep link callback.
  opening,

  /// Deep link received, posting to /connect.
  posting,

  /// Successfully connected (strava_tokens row written server-side).
  connected,

  /// Server returned 409 — Strava account linked to a different DA2 user.
  accountConflict,

  /// Generic 4xx error.
  authError,

  /// Network / 5xx error.
  networkError,
}

class StravaOAuthState {
  const StravaOAuthState({
    required this.status,
    this.errorMessage,
  });

  final StravaConnectionStatus status;
  final String? errorMessage;

  bool get isConnected => status == StravaConnectionStatus.connected;
  bool get isLoading =>
      status == StravaConnectionStatus.opening ||
      status == StravaConnectionStatus.posting;
}

// ---------------------------------------------------------------------------
// HTTP seam (injectable for tests)
// ---------------------------------------------------------------------------

/// Return type for the API poster seam.
typedef ApiResponse = ({int status, Object? body});

/// Signature for the HTTP poster seam.
typedef ApiPoster = Future<ApiResponse> Function(
  String path, {
  String? accessToken,
  Map<String, dynamic>? body,
});

/// Browser launcher seam — allows tests to skip actual url_launcher calls.
/// Returns true if the browser was successfully opened.
typedef BrowserLauncher = Future<bool> Function(Uri url);

Future<ApiResponse> _defaultApiPost(
  String path, {
  String? accessToken,
  Map<String, dynamic>? body,
}) async {
  final uri = Uri.parse('${Env.apiBaseUrl}$path');
  final response = await http.post(
    uri,
    headers: {
      'Content-Type': 'application/json',
      if (accessToken != null) 'Authorization': 'Bearer $accessToken',
    },
    body: body != null ? jsonEncode(body) : '{}',
  );
  Object? parsed;
  try {
    parsed = jsonDecode(response.body);
  } catch (_) {
    parsed = null;
  }
  return (status: response.statusCode, body: parsed);
}

Future<bool> _defaultBrowserLauncher(Uri url) async {
  return launchUrl(url, mode: LaunchMode.externalApplication);
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

/// Manages the Strava OAuth PKCE flow for Flutter.
///
/// Inject [apiPosterOverride], [browserLauncherOverride], and [accessTokenOverride]
/// in tests to avoid real HTTP calls, url_launcher, and Supabase auth.
class StravaOAuthService extends AutoDisposeAsyncNotifier<StravaOAuthState> {
  final ApiPoster? _apiPosterOverride;
  final BrowserLauncher? _browserLauncherOverride;

  /// @visibleForTesting — provides a fixed access token without reading Supabase auth.
  final String? accessTokenOverride;

  StravaOAuthService({
    ApiPoster? apiPosterOverride,
    BrowserLauncher? browserLauncherOverride,
    this.accessTokenOverride,
  })  : _apiPosterOverride = apiPosterOverride,
        _browserLauncherOverride = browserLauncherOverride;

  @override
  Future<StravaOAuthState> build() async {
    return const StravaOAuthState(status: StravaConnectionStatus.notConnected);
  }

  Future<void> connect() async {
    // Idempotent guard: don't start a second flow if one is in progress.
    final current = state.valueOrNull;
    if (current != null && current.isLoading) return;

    final accessToken = _readAccessToken();
    state = const AsyncData(
      StravaOAuthState(status: StravaConnectionStatus.opening),
    );

    // 1. POST /api/integrations/strava/init → signed state nonce.
    final signedState = await _fetchSignedState(accessToken);
    if (signedState == null) {
      state = const AsyncData(StravaOAuthState(
        status: StravaConnectionStatus.authError,
        errorMessage: 'Failed to initialise Strava OAuth. Please try again.',
      ));
      return;
    }

    // 2. Generate PKCE.
    final codeVerifier = generateCodeVerifier();
    final codeChallenge = deriveCodeChallenge(codeVerifier);

    // 3. Build the Strava authorization URL.
    final stravaUrl = Uri.https('www.strava.com', '/oauth/authorize', {
      'client_id': const String.fromEnvironment('STRAVA_CLIENT_ID'),
      'response_type': 'code',
      'redirect_uri': _redirectUri,
      'approval_prompt': 'auto',
      'scope': _stravaScopes,
      'state': signedState,
      'code_challenge': codeChallenge,
      'code_challenge_method': 'S256',
    });

    // 4. Register deep-link handler BEFORE launching the browser so the
    //    callback is never lost.
    final completer = Completer<Uri?>();
    StravaDeepLinkBridge.register((uri) {
      if (!completer.isCompleted) {
        completer.complete(uri);
      }
    });

    // 5. Launch the external browser (Strava ToS prohibits webview).
    bool launched = false;
    try {
      launched = await _launchBrowser(stravaUrl);
    } catch (_) {
      launched = false;
    }

    if (!launched) {
      StravaDeepLinkBridge.unregister();
      state = const AsyncData(StravaOAuthState(
        status: StravaConnectionStatus.networkError,
        errorMessage:
            'Could not open Strava. Check that a browser is installed.',
      ));
      return;
    }

    // 6. Wait for the deep link callback (or timeout after 10 minutes).
    Uri? callbackUri;
    try {
      callbackUri = await completer.future.timeout(
        const Duration(minutes: 10),
        onTimeout: () => null,
      );
    } catch (_) {
      callbackUri = null;
    } finally {
      StravaDeepLinkBridge.unregister();
    }

    if (callbackUri == null) {
      // Timeout or cancelled.
      state = const AsyncData(
        StravaOAuthState(status: StravaConnectionStatus.notConnected),
      );
      return;
    }

    final code = callbackUri.queryParameters['code'];
    if (code == null || code.isEmpty) {
      // Strava returned an error (e.g. user denied access).
      state = const AsyncData(StravaOAuthState(
        status: StravaConnectionStatus.authError,
        errorMessage: 'Strava authorisation was denied or failed.',
      ));
      return;
    }

    // 7. Validate CSRF state before posting the token exchange.
    final returnedState = callbackUri.queryParameters['state'];
    if (returnedState == null || returnedState != signedState) {
      state = const AsyncData(StravaOAuthState(
        status: StravaConnectionStatus.authError,
        errorMessage: 'OAuth state mismatch — please try connecting again.',
      ));
      return;
    }

    state = const AsyncData(
      StravaOAuthState(status: StravaConnectionStatus.posting),
    );

    await _postConnect(
      code: code,
      codeVerifier: codeVerifier,
      returnedState: returnedState,
      accessToken: accessToken,
    );
  }

  void reset() {
    state = const AsyncData(
      StravaOAuthState(status: StravaConnectionStatus.notConnected),
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /// Returns the Supabase access token, or [accessTokenOverride] if set.
  String? _readAccessToken() {
    if (accessTokenOverride != null) return accessTokenOverride;
    try {
      return ref.read(authNotifierProvider).valueOrNull?.accessToken;
    } catch (_) {
      return null;
    }
  }

  /// Overridable in tests to skip the real url_launcher call.
  Future<bool> _launchBrowser(Uri url) {
    final launcher = _browserLauncherOverride ?? _defaultBrowserLauncher;
    return launcher(url);
  }

  Future<String?> _fetchSignedState(String? accessToken) async {
    try {
      final poster = _apiPosterOverride ?? _defaultApiPost;
      final result = await poster(
        '/api/integrations/strava/init',
        accessToken: accessToken,
        body: {},
      );
      if (result.status != 200) return null;
      final body = result.body;
      if (body is! Map) return null;
      final stateVal = body['state'];
      return stateVal is String && stateVal.isNotEmpty ? stateVal : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> _postConnect({
    required String code,
    required String codeVerifier,
    required String returnedState,
    String? accessToken,
  }) async {
    try {
      final poster = _apiPosterOverride ?? _defaultApiPost;
      final result = await poster(
        '/api/integrations/strava/connect',
        accessToken: accessToken,
        body: {
          'code': code,
          'code_verifier': codeVerifier,
          'redirect_uri': _redirectUri,
          'state': returnedState,
        },
      );
      switch (result.status) {
        case 200:
        case 202:
          state = const AsyncData(
            StravaOAuthState(status: StravaConnectionStatus.connected),
          );
        case 409:
          state = const AsyncData(StravaOAuthState(
            status: StravaConnectionStatus.accountConflict,
            errorMessage:
                'This Strava account is already linked to another Daily Athlete user.',
          ));
        default:
          state = const AsyncData(StravaOAuthState(
            status: StravaConnectionStatus.authError,
            errorMessage: 'Could not connect Strava. Please try again.',
          ));
      }
    } catch (_) {
      state = const AsyncData(StravaOAuthState(
        status: StravaConnectionStatus.networkError,
        errorMessage: 'Network error. Please check your connection.',
      ));
    }
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final stravaOAuthServiceProvider =
    AsyncNotifierProvider.autoDispose<StravaOAuthService, StravaOAuthState>(
  StravaOAuthService.new,
);
