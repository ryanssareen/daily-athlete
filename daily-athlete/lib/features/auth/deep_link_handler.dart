import 'package:app_links/app_links.dart';

/// Single deep-link listener for the da2:// scheme — Strava only.
///
///   da2://strava-oauth?code=...   → StravaOAuthService
///
/// NOTE: da2://auth/callback (Google/Apple OAuth return) is intentionally NOT
/// handled here. supabase_flutter v2 auto-detects the OAuth redirect on the
/// registered URL scheme and exchanges the code itself. Exchanging it a second
/// time here races the SDK: whichever runs first consumes the single-use code
/// and clears the PKCE verifier, so the other fails with "code verifier not
/// found in storage" and the session is left flaky.
abstract final class DeepLinkHandler {
  static void initialize(AppLinks appLinks) {
    appLinks.uriLinkStream.listen(_handleUri, onError: (_) {});
  }

  static Future<void> _handleUri(Uri uri) async {
    if (uri.scheme != 'da2') return;

    if (uri.host == 'strava-oauth') {
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
