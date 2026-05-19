import 'package:app_links/app_links.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Single deep-link listener for the da2:// scheme.
/// Dispatches by URI host.
///
///   da2://auth/callback?code=...  → supabase.auth.exchangeCodeForSession (OAuth return)
///   da2://strava-oauth?code=...   → StravaOAuthService
abstract final class DeepLinkHandler {
  static void initialize(AppLinks appLinks) {
    appLinks.uriLinkStream.listen(_handleUri, onError: (_) {});
  }

  static Future<void> _handleUri(Uri uri) async {
    if (uri.scheme != 'da2') return;

    if (uri.host == 'auth' && uri.path == '/callback') {
      final code = uri.queryParameters['code'];
      if (code != null && code.isNotEmpty) {
        try {
          await Supabase.instance.client.auth.exchangeCodeForSession(code);
        } catch (_) {
          // Session exchange failed; auth state remains unauthenticated.
        }
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
