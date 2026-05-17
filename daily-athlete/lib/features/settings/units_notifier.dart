// UnitsNotifier — persists distance, swim distance, and weight unit preferences.
//
// Storage key prefix: 'da2.units.' in flutter_secure_storage.
// v1: local-only (no DB column). Units are read at render time by calendar
// and activity widgets.
//
// Defaults:
//   distance:     'km'
//   swimDistance: 'm'
//   weight:       'kg'

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _kDistanceKey = 'da2.units.distance';
const _kSwimDistanceKey = 'da2.units.swimDistance';
const _kWeightKey = 'da2.units.weight';

class UnitsPrefs {
  const UnitsPrefs({
    this.distance = 'km',
    this.swimDistance = 'm',
    this.weight = 'kg',
  });

  /// 'km' | 'miles'
  final String distance;

  /// 'm' | 'yards'
  final String swimDistance;

  /// 'kg' | 'lbs'
  final String weight;

  UnitsPrefs copyWith({
    String? distance,
    String? swimDistance,
    String? weight,
  }) {
    return UnitsPrefs(
      distance: distance ?? this.distance,
      swimDistance: swimDistance ?? this.swimDistance,
      weight: weight ?? this.weight,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is UnitsPrefs &&
      other.distance == distance &&
      other.swimDistance == swimDistance &&
      other.weight == weight;

  @override
  int get hashCode => Object.hash(distance, swimDistance, weight);
}

// ---------------------------------------------------------------------------
// Storage provider — override in tests to inject an in-memory fake.
// ---------------------------------------------------------------------------

/// Provides the [FlutterSecureStorage] instance used by [UnitsNotifier].
/// Override in tests to inject an in-memory store:
///
/// ```dart
/// unitsStorageProvider.overrideWithValue(_FakeStorage())
/// ```
final unitsStorageProvider = Provider<FlutterSecureStorage>(
  (_) => const FlutterSecureStorage(),
);

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

class UnitsNotifier extends AsyncNotifier<UnitsPrefs> {
  @override
  Future<UnitsPrefs> build() async {
    final storage = ref.read(unitsStorageProvider);
    try {
      final results = await Future.wait([
        storage.read(key: _kDistanceKey),
        storage.read(key: _kSwimDistanceKey),
        storage.read(key: _kWeightKey),
      ]);
      return UnitsPrefs(
        distance: _validDistance(results[0]) ?? 'km',
        swimDistance: _validSwim(results[1]) ?? 'm',
        weight: _validWeight(results[2]) ?? 'kg',
      );
    } catch (_) {
      // Storage read failure → fall back to defaults.
      return const UnitsPrefs();
    }
  }

  Future<void> setDistance(String value) async {
    if (!_validDistanceValues.contains(value)) return;
    final current = state.valueOrNull ?? const UnitsPrefs();
    state = AsyncData(current.copyWith(distance: value));
    try {
      await ref.read(unitsStorageProvider).write(key: _kDistanceKey, value: value);
    } catch (_) {}
  }

  Future<void> setSwimDistance(String value) async {
    if (!_validSwimValues.contains(value)) return;
    final current = state.valueOrNull ?? const UnitsPrefs();
    state = AsyncData(current.copyWith(swimDistance: value));
    try {
      await ref
          .read(unitsStorageProvider)
          .write(key: _kSwimDistanceKey, value: value);
    } catch (_) {}
  }

  Future<void> setWeight(String value) async {
    if (!_validWeightValues.contains(value)) return;
    final current = state.valueOrNull ?? const UnitsPrefs();
    state = AsyncData(current.copyWith(weight: value));
    try {
      await ref.read(unitsStorageProvider).write(key: _kWeightKey, value: value);
    } catch (_) {}
  }

  static const _validDistanceValues = {'km', 'miles'};
  static const _validSwimValues = {'m', 'yards'};
  static const _validWeightValues = {'kg', 'lbs'};

  static String? _validDistance(String? v) =>
      _validDistanceValues.contains(v) ? v : null;
  static String? _validSwim(String? v) =>
      _validSwimValues.contains(v) ? v : null;
  static String? _validWeight(String? v) =>
      _validWeightValues.contains(v) ? v : null;
}

final unitsNotifierProvider =
    AsyncNotifierProvider<UnitsNotifier, UnitsPrefs>(UnitsNotifier.new);
