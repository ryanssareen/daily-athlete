import 'package:daily_athlete/core/env.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Env.validationError', () {
    test('returns null when all values are present', () {
      final error = Env.validationError(
        supabaseUrl: 'https://xxx.supabase.co',
        supabaseAnonKey: 'anon-key',
        apiBaseUrl: 'https://da2-one.vercel.app',
      );
      expect(error, isNull);
    });

    test('reports a single missing value by name', () {
      final error = Env.validationError(
        supabaseUrl: '',
        supabaseAnonKey: 'anon-key',
        apiBaseUrl: 'https://da2-one.vercel.app',
      );
      expect(error, contains('SUPABASE_URL'));
      expect(error, isNot(contains('SUPABASE_ANON_KEY')));
      expect(error, isNot(contains('API_BASE_URL')));
    });

    test('reports all missing values when none are set', () {
      final error = Env.validationError(
        supabaseUrl: '',
        supabaseAnonKey: '',
        apiBaseUrl: '',
      );
      expect(error, contains('SUPABASE_URL'));
      expect(error, contains('SUPABASE_ANON_KEY'));
      expect(error, contains('API_BASE_URL'));
    });
  });

  group('Env.assertComplete', () {
    test('throws a StateError naming the missing dart-define', () {
      // Env's own const fields are compiled with empty String.fromEnvironment
      // values in the test binary (no --dart-define passed), so calling the
      // real assertComplete() here exercises the throwing path end-to-end.
      expect(
        Env.assertComplete,
        throwsA(
          isA<StateError>().having(
            (e) => e.message,
            'message',
            allOf(contains('SUPABASE_URL'), contains('--dart-define')),
          ),
        ),
      );
    });
  });
}
