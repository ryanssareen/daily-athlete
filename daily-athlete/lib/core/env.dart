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

  /// Validates the current build-time config, returning the human-readable
  /// error message to throw, or `null` if everything required is present.
  ///
  /// Pure function (no I/O, no throwing) so it can be unit-tested without a
  /// Flutter binding or a real --dart-define build.
  static String? validationError({
    required String supabaseUrl,
    required String supabaseAnonKey,
    required String apiBaseUrl,
  }) {
    final missing = <String>[
      if (supabaseUrl.isEmpty) 'SUPABASE_URL',
      if (supabaseAnonKey.isEmpty) 'SUPABASE_ANON_KEY',
      if (apiBaseUrl.isEmpty) 'API_BASE_URL',
    ];
    if (missing.isEmpty) return null;
    return 'Missing required --dart-define value(s): ${missing.join(', ')}. '
        'This build was not configured with the required environment '
        'values — see lib/core/env.dart for usage.';
  }

  /// Throws a [StateError] if any required --dart-define value is missing.
  ///
  /// Unlike `assert()`, this runs in every build mode, including release —
  /// a release build shipped without --dart-define values must fail loudly
  /// here rather than surfacing a confusing low-level error (e.g. an empty
  /// Supabase URL causing "No host specified in URI") deep in the SDK.
  static void assertComplete() {
    final error = validationError(
      supabaseUrl: supabaseUrl,
      supabaseAnonKey: supabaseAnonKey,
      apiBaseUrl: apiBaseUrl,
    );
    if (error != null) {
      throw StateError(error);
    }
  }
}
