import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

/// Single deep-link listener for the da2:// scheme.
/// Dispatches by URI host.
///
///   da2://auth/callback?code=...  → closes the sign-in browser sheet; the
///                                   code exchange itself is done by
///                                   supabase_flutter's own deep-link observer
///                                   (exchanging here too would race it and
///                                   burn the one-shot PKCE verifier)
///   da2://strava-oauth?code=...   → StravaOAuthService
abstract final class DeepLinkHandler {
  static void initialize(AppLinks appLinks) {
    appLinks.uriLinkStream.listen(_handleUri, onError: (_) {});
  }

  /// Set when the OAuth provider sent the user back with an error instead of
  /// a code (e.g. they denied access). Cleared on the next successful link.
  static final ValueNotifier<String?> callbackError = ValueNotifier(null);

  static Future<void> _handleUri(Uri uri) async {
    if (uri.scheme != 'da2') return;

    if (uri.host == 'auth' && uri.path == '/callback') {
      // On iOS the Google/Apple page lives in an SFSafariViewController that
      // stays on top of the app after the redirect, showing a blank page,
      // until it is closed explicitly.
      try {
        await closeInAppWebView();
      } catch (_) {
        // Not supported on this platform / nothing open.
      }
      final error =
          uri.queryParameters['error_description'] ??
          uri.queryParameters['error'];
      if (error != null && error.isNotEmpty) {
        callbackError.value = "Couldn't sign you in. Please try again.";
      } else {
        callbackError.value = null;
      }
    } else if (uri.host == 'strava-oauth') {
      StravaDeepLinkBridge.handleCallback(uri);
    }
  }
}

/// Bridge for the Strava OAuth callback; StravaOAuthService registers a handler here.
abstract final class StravaDeepLinkBridge {
  static void Function(Uri)? _handler;

  static void register(void Function(Uri) handler) {
    _handler = handler;
  }

  static void unregister() {
    _handler = null;
  }

  static void handleCallback(Uri uri) {
    _handler?.call(uri);
  }
}
