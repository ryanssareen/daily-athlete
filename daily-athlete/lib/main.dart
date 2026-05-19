import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'app.dart';
import 'core/env.dart';
import 'core/supabase_secure_storage.dart';
import 'features/auth/deep_link_handler.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  Env.assertComplete();

  await Supabase.initialize(
    url: Env.supabaseUrl,
    anonKey: Env.supabaseAnonKey,
    authOptions: FlutterAuthClientOptions(
      localStorage: SupabaseSecureLocalStorage(),
    ),
    debug: false,
  );

  // Listen for incoming deep links before the widget tree builds.
  // DeepLinkHandler dispatches by URI host:
  //   da2://auth/callback   → supabase.auth.exchangeCodeForSession (Google/Apple OAuth)
  //   da2://strava-oauth    → StravaOAuthService
  final appLinks = AppLinks();
  DeepLinkHandler.initialize(appLinks);

  runApp(const ProviderScope(child: DA2App()));
}
