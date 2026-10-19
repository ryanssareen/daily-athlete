import 'package:daily_athlete/features/profile/timezone_sync.dart';
import 'package:flutter_test/flutter_test.dart';

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
    test('PATCHes the device zone on mismatch', () async {
      final sent = <String>[];
      await syncTimezoneIfNeeded(
        detect: () async => 'Asia/Calcutta',
        fetchStored: () async => 'UTC',
        patch: (tz) async => sent.add(tz),
      );
      expect(sent, ['Asia/Calcutta']);
    });

    test('does not PATCH when zones match', () async {
      final sent = <String>[];
      await syncTimezoneIfNeeded(
        detect: () async => 'UTC',
        fetchStored: () async => 'UTC',
        patch: (tz) async => sent.add(tz),
      );
      expect(sent, isEmpty);
    });

    test('is silent when detection fails', () async {
      var patched = false;
      await syncTimezoneIfNeeded(
        detect: () async => throw StateError('no plugin'),
        fetchStored: () async => 'UTC',
        patch: (_) async => patched = true,
      );
      expect(patched, isFalse);
    });

    test('is silent when the stored-zone read fails', () async {
      var patched = false;
      await syncTimezoneIfNeeded(
        detect: () async => 'Asia/Calcutta',
        fetchStored: () async => throw StateError('offline'),
        patch: (_) async => patched = true,
      );
      expect(patched, isFalse);
    });

    test('is silent when the PATCH fails', () async {
      await syncTimezoneIfNeeded(
        detect: () async => 'Asia/Calcutta',
        fetchStored: () async => 'UTC',
        patch: (_) async => throw StateError('500'),
      );
    });
  });
}
