/// Environment configuration read from --dart-define build arguments.
///
/// Usage:
///   flutter run \
///     --dart-define=SUPABASE_URL=https://xxx.supabase.co \
///     --dart-define=SUPABASE_ANON_KEY=... \
///     --dart-define=API_BASE_URL=https://da2-one.vercel.app
///
/// Never commit actual values. Document in .env.local.example.
abstract final class Env {
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL');

  static void assertComplete() {
    assert(supabaseUrl.isNotEmpty, 'SUPABASE_URL is required (--dart-define)');
    assert(supabaseAnonKey.isNotEmpty, 'SUPABASE_ANON_KEY is required (--dart-define)');
    assert(apiBaseUrl.isNotEmpty, 'API_BASE_URL is required (--dart-define)');
  }
}
