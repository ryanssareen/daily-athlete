// Pure Dart unit tests for activities provider logic.
//
// These tests do NOT require a Supabase connection or Flutter widget tree.
// They exercise filtering logic and the key-metric helper directly.
//
// Test scenarios:
//   1. Feed filtered by sport: mixed list → filter to 'run' returns only run rows.
//   2. Feed filtered by sport: filter to 'strength' returns only strength rows.
//   3. Empty feed: returns empty list without crashing.
//   4. Activity row key metric: run with 10 500 m → "10.5 km".
//   5. Activity row key metric: strength with 3 600 s, no distance → "1h 0m".
//   6. Activity row key metric: no distance, no duration → empty string.
//   7. formatDuration: sub-hour → "mm" without hours prefix.

import 'package:daily_athlete/features/activities/activity_row.dart';
import 'package:daily_athlete/models/completed_workout.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:flutter_test/flutter_test.dart';

// ---------------------------------------------------------------------------
// Helpers — create minimal CompletedWorkoutRows for testing
// ---------------------------------------------------------------------------

CompletedWorkoutRow _makeRow({
  required Sport sport,
  double? distanceM,
  int? durationS,
  String id = 'cw-x',
}) {
  return CompletedWorkoutRow(
    id: id,
    athleteId: 'user-1',
    source: CompletedWorkoutSource.manual,
    startedAt: DateTime(2026, 5, 17, 8),
    sport: sport,
    summaryStats: const {},
    distanceM: distanceM,
    durationS: durationS,
  );
}

/// Client-side filter: return rows matching [sport], or all rows if null.
/// Mirrors the logic in filteredFeedProvider.
List<CompletedWorkoutRow> _filter(
  List<CompletedWorkoutRow> rows,
  Sport? sport,
) {
  if (sport == null) return rows;
  return rows.where((r) => r.sport == sport).toList();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('Client-side sport filter', () {
    final mixed = [
      _makeRow(sport: Sport.run, distanceM: 10500, durationS: 3600, id: 'r1'),
      _makeRow(sport: Sport.run, distanceM: 5000, durationS: 1500, id: 'r2'),
      _makeRow(sport: Sport.strength, durationS: 3600, id: 's1'),
      _makeRow(sport: Sport.swim, distanceM: 2000, durationS: 2400, id: 'sw1'),
      _makeRow(sport: Sport.bike, distanceM: 40000, durationS: 5400, id: 'b1'),
    ];

    test('filter to run returns only run rows', () {
      final result = _filter(mixed, Sport.run);
      expect(result.length, 2);
      expect(result.every((r) => r.sport == Sport.run), isTrue);
    });

    test('filter to strength returns only strength rows', () {
      final result = _filter(mixed, Sport.strength);
      expect(result.length, 1);
      expect(result.first.id, 's1');
    });

    test('null filter (All) returns full list', () {
      final result = _filter(mixed, null);
      expect(result.length, mixed.length);
    });

    test('filter with no matching sport returns empty list', () {
      final result = _filter(mixed, Sport.other);
      expect(result, isEmpty);
    });
  });

  group('Empty feed', () {
    test('filtering empty list returns empty list without crashing', () {
      final result = _filter([], Sport.run);
      expect(result, isEmpty);
    });

    test('null sport filter on empty list returns empty list', () {
      final result = _filter([], null);
      expect(result, isEmpty);
    });
  });

  group('keyMetricFor', () {
    test('run with distance 10 500 m returns "10.5 km"', () {
      final row = _makeRow(
        sport: Sport.run,
        distanceM: 10500,
        durationS: 3600,
      );
      expect(keyMetricFor(row), '10.5 km');
    });

    test('strength with 3 600 s and no distance returns "1h 0m"', () {
      final row = _makeRow(sport: Sport.strength, durationS: 3600);
      expect(keyMetricFor(row), '1h 0m');
    });

    test('swim with 2 000 m returns "2.0 km"', () {
      final row = _makeRow(sport: Sport.swim, distanceM: 2000, durationS: 2400);
      expect(keyMetricFor(row), '2.0 km');
    });

    test('row with no distance and no duration returns empty string', () {
      final row = _makeRow(sport: Sport.other);
      expect(keyMetricFor(row), '');
    });

    test('distance of 0 falls through to duration', () {
      final row = _makeRow(sport: Sport.run, distanceM: 0, durationS: 1800);
      expect(keyMetricFor(row), '30m');
    });
  });

  group('formatDuration', () {
    test('3 600 s → "1h 0m"', () {
      expect(formatDuration(3600), '1h 0m');
    });

    test('3 900 s → "1h 5m"', () {
      expect(formatDuration(3900), '1h 5m');
    });

    test('1 800 s (30 min) → "30m"', () {
      expect(formatDuration(1800), '30m');
    });

    test('60 s → "1m"', () {
      expect(formatDuration(60), '1m');
    });

    test('0 s → "0m"', () {
      expect(formatDuration(0), '0m');
    });
  });
}
