// Unit tests for StravaOAuthService.
//
// All HTTP calls are intercepted via the [apiPosterOverride] seam.
// Browser launch is intercepted via the [browserLauncherOverride] seam.
// Auth token is injected via [accessTokenOverride] (no Supabase needed).
// Deep-link callbacks are injected directly via StravaDeepLinkBridge.handleCallback().
//
// Scenarios:
// - PKCE helpers: length and character set
// - Happy path: init → PKCE → browser → deep link → connect 202 → connected
// - init returns non-200 → authError state, connect never called
// - connect returns 409 → accountConflict state
// - connect returns 4xx other → authError state
// - Stale deep link (no pending PKCE) → bridge has no handler, no crash

import 'package:daily_athlete/features/auth/deep_link_handler.dart';
import 'package:daily_athlete/features/settings/strava_oauth_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// ---------------------------------------------------------------------------
// Test factory
// ---------------------------------------------------------------------------

/// Creates a [ProviderContainer] wiring up a [StravaOAuthService] with
/// injectable HTTP, browser-launch, and auth-token seams.
///
/// Adds a listener to the provider so it is NOT auto-disposed while an async
/// [connect()] flow is suspended awaiting a deep-link callback.
ProviderContainer _makeContainer({
  required ApiPoster poster,
  BrowserLauncher? browserLauncher,
  String? accessToken,
}) {
  final container = ProviderContainer(
    overrides: [
      stravaOAuthServiceProvider.overrideWith(
        () => StravaOAuthService(
          apiPosterOverride: poster,
          browserLauncherOverride:
              browserLauncher ?? ((_) async => true), // default: "opened"
          accessTokenOverride: accessToken,
        ),
      ),
    ],
  );
  // Keep the provider alive for the container's lifetime so connect() is not
  // interrupted by auto-dispose while awaiting the deep-link completer.
  container.listen<AsyncValue<StravaOAuthState>>(
    stravaOAuthServiceProvider,
    (_, _) {},
  );
  return container;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // Ensure the bridge is clean between tests.
  tearDown(() => StravaDeepLinkBridge.unregister());

  // -------------------------------------------------------------------------
  // PKCE helpers
  // -------------------------------------------------------------------------

  group('PKCE helpers', () {
    test('generateCodeVerifier returns 43–64 char base64url string', () {
      final v = generateCodeVerifier();
      expect(v.length, inInclusiveRange(43, 64));
      expect(RegExp(r'^[A-Za-z0-9\-_]+$').hasMatch(v), isTrue);
    });

    test('generateCodeVerifier produces different values each call', () {
      final a = generateCodeVerifier();
      final b = generateCodeVerifier();
      expect(a, isNot(equals(b)));
    });

    test('deriveCodeChallenge returns non-empty base64url string', () {
      final challenge = deriveCodeChallenge(generateCodeVerifier());
      expect(challenge, isNotEmpty);
      expect(RegExp(r'^[A-Za-z0-9\-_]+$').hasMatch(challenge), isTrue);
    });

    test('deriveCodeChallenge is deterministic', () {
      const v = 'deterministic-test-verifier-string';
      expect(deriveCodeChallenge(v), equals(deriveCodeChallenge(v)));
    });
  });

  // -------------------------------------------------------------------------
  // init error path
  // -------------------------------------------------------------------------

  group('init error path', () {
    test('init non-200 → authError state, connect never called', () async {
      var connectCalled = false;
      final container = _makeContainer(
        poster: (path, {accessToken, body}) async {
          if (path.contains('/init')) {
            return (status: 500, body: {'error': 'internal'});
          }
          connectCalled = true;
          return (status: 202, body: {});
        },
      );
      addTearDown(container.dispose);

      await container.read(stravaOAuthServiceProvider.future);
      await container.read(stravaOAuthServiceProvider.notifier).connect();

      final state = container.read(stravaOAuthServiceProvider).valueOrNull;
      expect(state?.status, StravaConnectionStatus.authError);
      expect(connectCalled, isFalse);
    });

    test('init 401 → authError state', () async {
      final container = _makeContainer(
        poster: (path, {accessToken, body}) async =>
            (status: 401, body: {'error': 'unauthorized'}),
      );
      addTearDown(container.dispose);

      await container.read(stravaOAuthServiceProvider.future);
      await container.read(stravaOAuthServiceProvider.notifier).connect();

      final state = container.read(stravaOAuthServiceProvider).valueOrNull;
      expect(state?.status, StravaConnectionStatus.authError);
    });
  });

  // -------------------------------------------------------------------------
  // connect 409 — already linked
  // -------------------------------------------------------------------------

  group('connect 409 — already linked', () {
    test('accountConflict state set with message', () async {
      final container = _makeContainer(
        accessToken: 'tok',
        poster: (path, {accessToken, body}) async {
          if (path.contains('/init')) {
            return (status: 200, body: {'state': 'nonce-abc'});
          }
          return (
            status: 409,
            body: {'error': 'strava_account_already_linked'},
          );
        },
      );
      addTearDown(container.dispose);

      await container.read(stravaOAuthServiceProvider.future);

      // Start connect in the background — it reaches browser launch, then
      // waits for the deep link.
      final connectFuture =
          container.read(stravaOAuthServiceProvider.notifier).connect();

      // Yield so the async flow reaches the bridge registration + browser launch.
      await Future<void>.delayed(Duration.zero);

      // Simulate the OS delivering the deep link after the user authorises.
      StravaDeepLinkBridge.handleCallback(
        Uri.parse('da2://strava-oauth?code=auth-code&state=nonce-abc'),
      );

      await connectFuture;

      final state = container.read(stravaOAuthServiceProvider).valueOrNull;
      expect(state?.status, StravaConnectionStatus.accountConflict);
      expect(state?.errorMessage, contains('already linked'));
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  group('happy path', () {
    test('init → PKCE → browser → deep link → connect 202 → connected', () async {
      String? capturedVerifier;
      String? capturedCode;

      final container = _makeContainer(
        accessToken: 'bearer-xyz',
        poster: (path, {accessToken, body}) async {
          if (path.contains('/init')) {
            return (status: 200, body: {'state': 'signed-nonce'});
          }
          if (path.contains('/connect')) {
            capturedVerifier = body?['code_verifier'] as String?;
            capturedCode = body?['code'] as String?;
            expect(body?['redirect_uri'], 'da2://strava-oauth');
            return (status: 202, body: {'status': 'connected'});
          }
          return (status: 500, body: null);
        },
      );
      addTearDown(container.dispose);

      await container.read(stravaOAuthServiceProvider.future);

      final connectFuture =
          container.read(stravaOAuthServiceProvider.notifier).connect();

      await Future<void>.delayed(Duration.zero);

      StravaDeepLinkBridge.handleCallback(
        Uri.parse('da2://strava-oauth?code=good-code&state=signed-nonce'),
      );

      await connectFuture;

      final state = container.read(stravaOAuthServiceProvider).valueOrNull;
      expect(state?.status, StravaConnectionStatus.connected);
      expect(capturedCode, 'good-code');
      expect(capturedVerifier, isNotNull);
      expect(capturedVerifier!.length, inInclusiveRange(43, 64));
    });
  });

  // -------------------------------------------------------------------------
  // Other 4xx error
  // -------------------------------------------------------------------------

  group('other 4xx error from /connect', () {
    test('connect 400 → authError state', () async {
      final container = _makeContainer(
        accessToken: 'tok',
        poster: (path, {accessToken, body}) async {
          if (path.contains('/init')) {
            return (status: 200, body: {'state': 'nonce'});
          }
          return (status: 400, body: {'error': 'bad_request'});
        },
      );
      addTearDown(container.dispose);

      await container.read(stravaOAuthServiceProvider.future);

      final connectFuture =
          container.read(stravaOAuthServiceProvider.notifier).connect();

      await Future<void>.delayed(Duration.zero);

      StravaDeepLinkBridge.handleCallback(
        Uri.parse('da2://strava-oauth?code=code&state=nonce'),
      );
      await connectFuture;

      final state = container.read(stravaOAuthServiceProvider).valueOrNull;
      expect(state?.status, StravaConnectionStatus.authError);
    });
  });

  // -------------------------------------------------------------------------
  // Stale deep link — no pending PKCE state
  // -------------------------------------------------------------------------

  group('stale deep link', () {
    test('callback with no pending flow → no crash', () {
      StravaDeepLinkBridge.unregister(); // ensure clean

      expect(
        () => StravaDeepLinkBridge.handleCallback(
          Uri.parse('da2://strava-oauth?code=stale&state=old'),
        ),
        returnsNormally,
      );
    });
  });
}
