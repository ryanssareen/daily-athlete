import 'package:daily_athlete/features/auth/auth_notifier.dart';
import 'package:daily_athlete/features/profile/timezone_sync.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' hide AuthState;

void main() {
  group('shouldSyncTimezone', () {
    test('syncs when the device zone differs from the stored one', () {
      expect(shouldSyncTimezone('Asia/Calcutta', 'UTC'), isTrue);
    });
    test('is a no-op when they match', () {
      expect(shouldSyncTimezone('Asia/Calcutta', 'Asia/Calcutta'), isFalse);
    });
    test('never syncs an empty or missing device zone', () {
      expect(shouldSyncTimezone(null, 'UTC'), isFalse);
      expect(shouldSyncTimezone('', 'UTC'), isFalse);
    });
    test('syncs when nothing is stored yet', () {
      expect(shouldSyncTimezone('America/Los_Angeles', null), isTrue);
    });
  });

  group('syncTimezoneIfNeeded', () {
    // Returns [reads, patches] counters via closures.
    Future<({int reads, List<String> patches})> run({
      required Future<String?> Function() detect,
      Future<String?> Function()? fetchStored,
      Future<void> Function(String)? patch,
    }) async {
      var reads = 0;
      final patches = <String>[];
      await expectLater(
        syncTimezoneIfNeeded(
          detect: detect,
          fetchStored: () async {
            reads++;
            return fetchStored == null ? 'UTC' : fetchStored();
          },
          patch: (tz) async {
            patches.add(tz);
            if (patch != null) await patch(tz);
          },
        ),
        completes,
      );
      return (reads: reads, patches: patches);
    }

    test('PATCHes the device zone on mismatch', () async {
      final r = await run(detect: () async => 'Asia/Calcutta');
      expect(r.patches, ['Asia/Calcutta']);
    });

    test('does not PATCH when zones match', () async {
      final r = await run(detect: () async => 'UTC');
      expect(r.reads, 1);
      expect(r.patches, isEmpty);
    });

    for (final detected in <String?>[null, '']) {
      test("detect -> ${detected == null ? 'null' : 'empty'} skips read and PATCH", () async {
        final r = await run(detect: () async => detected);
        expect(r.reads, 0);
        expect(r.patches, isEmpty);
      });
    }

    test('a null stored zone is patched with the detected value', () async {
      final r = await run(
        detect: () async => 'Asia/Calcutta',
        fetchStored: () async => null,
      );
      expect(r.patches, ['Asia/Calcutta']);
    });

    test('is silent when detection fails', () async {
      final r = await run(detect: () async => throw StateError('no plugin'));
      expect(r.reads, 0);
      expect(r.patches, isEmpty);
    });

    test('is silent when the stored-zone read fails', () async {
      final r = await run(
        detect: () async => 'Asia/Calcutta',
        fetchStored: () async => throw StateError('offline'),
      );
      expect(r.patches, isEmpty);
    });

    test('is silent when the PATCH fails (attempted exactly once)', () async {
      final r = await run(
        detect: () async => 'Asia/Calcutta',
        patch: (_) async => throw StateError('500'),
      );
      expect(r.patches, ['Asia/Calcutta']);
    });
  });

  group('timezoneSyncProvider', () {
    ProviderContainer make(AuthState auth, List<String> calls) => ProviderContainer(
          overrides: [
            authNotifierProvider.overrideWith(() => _FakeAuth(auth)),
            timezoneSyncRunnerProvider.overrideWithValue((id) async => calls.add(id)),
          ],
        );

    test('runs once for an authenticated user', () async {
      final calls = <String>[];
      final c = make(
        AuthState(status: AuthStatus.authenticated, session: _session('user-1')),
        calls,
      );
      addTearDown(c.dispose);
      await c.read(timezoneSyncProvider.future);
      expect(calls, ['user-1']);
    });

    test('never runs when unauthenticated', () async {
      final calls = <String>[];
      final c = make(const AuthState(status: AuthStatus.unauthenticated), calls);
      addTearDown(c.dispose);
      await c.read(timezoneSyncProvider.future);
      expect(calls, isEmpty);
    });
  });
}

class _FakeAuth extends AuthNotifier {
  _FakeAuth(this._state);
  final AuthState _state;
  @override
  Future<AuthState> build() async => _state;
}

Session _session(String userId) => Session(
      accessToken: 'token',
      tokenType: 'bearer',
      user: User(
        id: userId,
        appMetadata: const {},
        userMetadata: const {},
        aud: 'authenticated',
        createdAt: '2026-01-01T00:00:00Z',
      ),
    );
