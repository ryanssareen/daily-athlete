// Unit tests for UnitsNotifier.
//
// [unitsStorageProvider] is overridden with an in-memory _FakeStorage
// so no OS keychain access is required.
//
// Scenarios:
// - Default prefs (empty storage) → km / m / kg
// - setDistance('miles') persists; reloaded container reads 'miles'
// - Invalid value → ignored, default unchanged
// - Storage read failure → falls back to default 'km'
// - setSwimDistance and setWeight independently tested
// - UnitsPrefs copyWith and equality

import 'package:daily_athlete/features/settings/units_notifier.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

// ---------------------------------------------------------------------------
// Minimal in-memory FlutterSecureStorage fake
// ---------------------------------------------------------------------------

class _FakeStorage extends FlutterSecureStorage {
  final Map<String, String> _data = {};
  bool _shouldThrowOnRead = false;

  void failNextRead() => _shouldThrowOnRead = true;

  @override
  Future<String?> read({
    required String key,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (_shouldThrowOnRead) {
      _shouldThrowOnRead = false;
      throw Exception('storage read failed');
    }
    return _data[key];
  }

  @override
  Future<void> write({
    required String key,
    required String? value,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (value == null) {
      _data.remove(key);
    } else {
      _data[key] = value;
    }
  }

  @override
  Future<Map<String, String>> readAll({
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async =>
      Map.unmodifiable(_data);
}

// ---------------------------------------------------------------------------
// Test helper — builds a container with the fake storage
// ---------------------------------------------------------------------------

ProviderContainer _makeContainer(_FakeStorage fakeStorage) {
  return ProviderContainer(
    overrides: [
      unitsStorageProvider.overrideWithValue(fakeStorage),
    ],
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('UnitsPrefs defaults', () {
    test('first launch with empty storage → km / m / kg', () async {
      final fake = _FakeStorage();
      final container = _makeContainer(fake);
      addTearDown(container.dispose);

      final prefs = await container.read(unitsNotifierProvider.future);
      expect(prefs.distance, 'km');
      expect(prefs.swimDistance, 'm');
      expect(prefs.weight, 'kg');
    });
  });

  group('distance persistence', () {
    test('setDistance("miles") persists; reloaded container reads "miles"',
        () async {
      final fake = _FakeStorage();
      final container = _makeContainer(fake);
      addTearDown(container.dispose);

      await container.read(unitsNotifierProvider.future);
      await container.read(unitsNotifierProvider.notifier).setDistance('miles');

      // Dispose the first container and create a new one backed by the same
      // fake storage to simulate an app restart.
      container.dispose();

      final restarted = _makeContainer(fake);
      addTearDown(restarted.dispose);

      final reloadedPrefs = await restarted.read(unitsNotifierProvider.future);
      expect(reloadedPrefs.distance, 'miles');
    });

    test('setDistance with invalid value → ignored, remains km', () async {
      final fake = _FakeStorage();
      final container = _makeContainer(fake);
      addTearDown(container.dispose);

      await container.read(unitsNotifierProvider.future);
      await container
          .read(unitsNotifierProvider.notifier)
          .setDistance('furlongs'); // invalid

      final prefs = container.read(unitsNotifierProvider).valueOrNull;
      expect(prefs?.distance, 'km'); // unchanged
    });
  });

  group('swim distance persistence', () {
    test('setSwimDistance("yards") updates in-memory state', () async {
      final fake = _FakeStorage();
      final container = _makeContainer(fake);
      addTearDown(container.dispose);

      await container.read(unitsNotifierProvider.future);
      await container
          .read(unitsNotifierProvider.notifier)
          .setSwimDistance('yards');

      final prefs = container.read(unitsNotifierProvider).valueOrNull;
      expect(prefs?.swimDistance, 'yards');
    });
  });

  group('weight persistence', () {
    test('setWeight("lbs") updates in-memory state', () async {
      final fake = _FakeStorage();
      final container = _makeContainer(fake);
      addTearDown(container.dispose);

      await container.read(unitsNotifierProvider.future);
      await container.read(unitsNotifierProvider.notifier).setWeight('lbs');

      final prefs = container.read(unitsNotifierProvider).valueOrNull;
      expect(prefs?.weight, 'lbs');
    });
  });

  group('storage read failure', () {
    test('storage throws during build → falls back to default km', () async {
      final fake = _FakeStorage();
      fake.failNextRead(); // will throw on the first read
      final container = _makeContainer(fake);
      addTearDown(container.dispose);

      final prefs = await container.read(unitsNotifierProvider.future);
      expect(prefs.distance, 'km');
      expect(prefs.swimDistance, 'm');
      expect(prefs.weight, 'kg');
    });
  });

  group('UnitsPrefs.copyWith', () {
    test('changes only the specified field', () {
      const original = UnitsPrefs(
        distance: 'km',
        swimDistance: 'm',
        weight: 'kg',
      );
      final updated = original.copyWith(distance: 'miles');
      expect(updated.distance, 'miles');
      expect(updated.swimDistance, 'm'); // unchanged
      expect(updated.weight, 'kg'); // unchanged
    });
  });

  group('UnitsPrefs equality', () {
    test('identical prefs are equal', () {
      const a = UnitsPrefs();
      const b = UnitsPrefs();
      expect(a, equals(b));
    });

    test('different distance values are not equal', () {
      const a = UnitsPrefs(distance: 'km');
      const b = UnitsPrefs(distance: 'miles');
      expect(a, isNot(equals(b)));
    });
  });
}
