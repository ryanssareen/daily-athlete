// test/features/calendar/calendar_providers_test.dart
//
// Pure Dart tests for calendar_providers.dart helper logic.
//
// Exercises pure merge + aggregation functions that do NOT require a live
// Supabase connection or Flutter widget tree.

import 'package:daily_athlete/features/calendar/calendar_providers.dart';
import 'package:daily_athlete/models/completed_workout.dart';
import 'package:daily_athlete/models/planned_workout.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:daily_athlete/models/workout_match.dart';
import 'package:flutter_test/flutter_test.dart';

// ---------------------------------------------------------------------------
// Test row builders
// ---------------------------------------------------------------------------

PlannedWorkoutRow _pw({
  required String id,
  required String date, // YYYY-MM-DD
  required Sport sport,
}) {
  return PlannedWorkoutRow.fromJson({
    'id': id,
    'athlete_id': 'user-1',
    'scheduled_date': date,
    'sport': sport.name,
    'structure': <String, dynamic>{},
    'status': 'planned',
    'plan_id': null,
    'planned_load': null,
    'rationale': null,
    'edited_by_kind': null,
    'edited_by_user_id': null,
    'edited_at': null,
    'created_at': null,
    'deleted_at': null,
  });
}

CompletedWorkoutRow _cw({
  required String id,
  required String startedAt, // ISO-8601
  required Sport sport,
  int? durationS,
}) {
  return CompletedWorkoutRow.fromJson({
    'id': id,
    'athlete_id': 'user-1',
    'source': 'strava',
    'started_at': startedAt,
    'sport': sport.name,
    'summary_stats': <String, dynamic>{},
    'strava_activity_id': null,
    'distance_m': null,
    'duration_s': durationS,
    'superseded_by_id': null,
    'created_at': null,
    'deleted_at': null,
  });
}

/// ISO-8601 UTC string for the instant that is the given wall-clock time in the
/// zone the test runs in -- keeps "a day" fixtures independent of the host TZ.
String _local(int y, int m, int d, [int h = 0, int mi = 0, int s = 0]) =>
    DateTime(y, m, d, h, mi, s).toUtc().toIso8601String();

WorkoutMatchRow _match({
  required String plannedId,
  required String completedId,
  bool deleted = false,
}) {
  return WorkoutMatchRow(
    id: 'match-$plannedId-$completedId',
    plannedWorkoutId: plannedId,
    completedWorkoutId: completedId,
    confidence: 1,
    method: WorkoutMatchMethod.autoSameDaySport,
    matchedAt: DateTime.utc(2026, 6, 1),
    deletedAt: deleted ? DateTime.utc(2026, 6, 1) : null,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // -------------------------------------------------------------------------
  // Local-day bucketing
  //
  // PostgREST returns started_at as a UTC instant, so a workout at 05:00 IST
  // arrives as the previous UTC day. Keying on the UTC calendar day filed it
  // under yesterday. These instants are built from LOCAL components, so they
  // are "05:00 on the 19th" in whatever zone the test runs in -- run with
  // TZ=Asia/Kolkata and TZ=America/Los_Angeles to exercise the real bug; in
  // a UTC zone they pass trivially.
  // -------------------------------------------------------------------------

  group('local-day bucketing', () {
    String utcIso(DateTime local) => local.toUtc().toIso8601String();

    test('early-morning workout is keyed on the athlete\'s local day', () {
      final early = _cw(
        id: 'cw-early',
        startedAt: utcIso(DateTime(2026, 10, 19, 0, 30)),
        sport: Sport.run,
        durationS: 1800,
      );
      final map = mergeForTest([], [early], []);
      expect(map.keys, [DateTime.utc(2026, 10, 19)]);
      expect(aggregateYearHeatmap([early]), {DateTime.utc(2026, 10, 19): 1800});
    });

    test('a UTC-labelled selected day is not shifted by the local zone', () {
      // selectedDateProvider holds DateTime.utc(y, m, d); converting it with
      // toLocal() moved it to the previous day west of UTC (review finding).
      expect(calendarDayKey(DateTime.utc(2026, 10, 19)), DateTime.utc(2026, 10, 19));
      expect(calendarDayKey(DateTime(2026, 10, 19)), DateTime.utc(2026, 10, 19));
    });

    test('week fetch window runs local midnight to local midnight', () {
      final w = startedAtWindow(DateTime.utc(2026, 10, 19), DateTime.utc(2026, 10, 25));
      expect(w.from, DateTime(2026, 10, 19).toUtc().toIso8601String());
      expect(w.to, DateTime(2026, 10, 26).toUtc().toIso8601String());
      // A Monday 02:00 local run sits inside its own week's window.
      final run = DateTime(2026, 10, 19, 2).toUtc();
      expect(!run.isBefore(DateTime.parse(w.from)) && run.isBefore(DateTime.parse(w.to)), isTrue);
    });

    test('late-evening workout is keyed on the athlete\'s local day', () {
      final late = _cw(
        id: 'cw-late',
        startedAt: utcIso(DateTime(2026, 10, 19, 23, 30)),
        sport: Sport.run,
        durationS: 1800,
      );
      final map = mergeForTest([], [late], []);
      expect(map.keys, [DateTime.utc(2026, 10, 19)]);
    });
  });

  // -------------------------------------------------------------------------
  // aggregateYearHeatmap
  // -------------------------------------------------------------------------

  group('aggregateYearHeatmap', () {
    test('returns empty map for empty input', () {
      final result = aggregateYearHeatmap([]);
      expect(result, isEmpty);
    });

    test('sums duration_s for workouts on the same local day', () {
      final workouts = [
        _cw(
          id: 'cw-1',
          startedAt: _local(2026, 6, 1, 8, 0, 0),
          sport: Sport.run,
          durationS: 3600,
        ),
        _cw(
          id: 'cw-2',
          startedAt: _local(2026, 6, 1, 18, 0, 0),
          sport: Sport.strength,
          durationS: 2700,
        ),
      ];
      final result = aggregateYearHeatmap(workouts);
      expect(result.length, 1);
      expect(result[DateTime.utc(2026, 6, 1)], 6300);
    });

    test('keeps separate entries for different days', () {
      final workouts = [
        _cw(
            id: 'cw-1',
            startedAt: _local(2026, 6, 1, 8, 0, 0),
            sport: Sport.run,
            durationS: 3600),
        _cw(
            id: 'cw-2',
            startedAt: _local(2026, 6, 2, 9, 0, 0),
            sport: Sport.swim,
            durationS: 1800),
      ];
      final result = aggregateYearHeatmap(workouts);
      expect(result.length, 2);
      expect(result[DateTime.utc(2026, 6, 1)], 3600);
      expect(result[DateTime.utc(2026, 6, 2)], 1800);
    });

    test('null duration_s contributes 0', () {
      final workouts = [
        _cw(
            id: 'cw-1',
            startedAt: _local(2026, 6, 1, 8, 0, 0),
            sport: Sport.run,
            durationS: null),
        _cw(
            id: 'cw-2',
            startedAt: _local(2026, 6, 1, 18, 0, 0),
            sport: Sport.strength,
            durationS: 1200),
      ];
      final result = aggregateYearHeatmap(workouts);
      expect(result[DateTime.utc(2026, 6, 1)], 1200);
    });

    test('timestamps at different times of the same local day share one bucket',
        () {
      final workouts = [
        _cw(
            id: 'cw-1',
            startedAt: _local(2026, 6, 1, 0, 0, 0),
            sport: Sport.run,
            durationS: 100),
        _cw(
            id: 'cw-2',
            startedAt: _local(2026, 6, 1, 23, 59, 59),
            sport: Sport.swim,
            durationS: 200),
      ];
      final result = aggregateYearHeatmap(workouts);
      expect(result.length, 1);
      expect(result[DateTime.utc(2026, 6, 1)], 300);
    });

    test('very high load day (8 hours) aggregates without overflow', () {
      final workouts = [
        _cw(
            id: 'cw-1',
            startedAt: _local(2026, 6, 1, 6, 0, 0),
            sport: Sport.bike,
            durationS: 28800),
      ];
      final result = aggregateYearHeatmap(workouts);
      expect(result[DateTime.utc(2026, 6, 1)], 28800);
    });
  });

  // -------------------------------------------------------------------------
  // mergeForTest (week data merge)
  // -------------------------------------------------------------------------

  group('mergeForTest', () {
    test('returns empty map for empty inputs', () {
      final result = mergeForTest([], [], []);
      expect(result, isEmpty);
    });

    test('planned workout appears on its scheduled date', () {
      final planned = [_pw(id: 'pw-1', date: '2026-06-01', sport: Sport.run)];
      final result = mergeForTest(planned, [], []);
      final key = DateTime.utc(2026, 6, 1);
      expect(result.containsKey(key), isTrue);
      expect(result[key]!.length, 1);
      final summary = result[key]!.first;
      expect(summary.planned, isNotNull);
      expect(summary.completed, isNull);
    });

    test('completed workout appears on its start date', () {
      final completed = [
        _cw(
            id: 'cw-1',
            startedAt: _local(2026, 6, 1, 8, 0, 0),
            sport: Sport.run,
            durationS: 3600),
      ];
      final result = mergeForTest([], completed, []);
      final key = DateTime.utc(2026, 6, 1);
      expect(result[key]!.length, 1);
      final summary = result[key]!.first;
      expect(summary.completed, isNotNull);
      expect(summary.planned, isNull);
    });

    test(
        'planned and completed on same day with no match both appear separately',
        () {
      final planned = [_pw(id: 'pw-1', date: '2026-06-01', sport: Sport.run)];
      final completed = [
        _cw(
            id: 'cw-1',
            startedAt: _local(2026, 6, 1, 8, 0, 0),
            sport: Sport.run,
            durationS: 3600),
      ];
      final result = mergeForTest(planned, completed, []);
      final key = DateTime.utc(2026, 6, 1);
      // Unmatched planned + completed on the same day stay as separate items.
      expect(result[key]!.length, 2);
    });

    test('a live match merges planned + completed into one ActivitySummary',
        () {
      final planned = [_pw(id: 'pw-1', date: '2026-06-01', sport: Sport.run)];
      final completed = [
        _cw(
            id: 'cw-1',
            startedAt: _local(2026, 6, 1, 8, 0, 0),
            sport: Sport.run,
            durationS: 3600),
      ];
      final matches = [_match(plannedId: 'pw-1', completedId: 'cw-1')];
      final result = mergeForTest(planned, completed, matches);
      final key = DateTime.utc(2026, 6, 1);
      expect(result[key]!.length, 1);
      final summary = result[key]!.first;
      expect(summary.planned, isNotNull);
      expect(summary.completed, isNotNull);
      expect(summary.completed!.id, 'cw-1');
      expect(summary.isCompleted, isTrue);
    });

    test('a soft-deleted match does not merge — both stay separate', () {
      final planned = [_pw(id: 'pw-1', date: '2026-06-01', sport: Sport.run)];
      final completed = [
        _cw(
            id: 'cw-1',
            startedAt: _local(2026, 6, 1, 8, 0, 0),
            sport: Sport.run,
            durationS: 3600),
      ];
      final matches = [
        _match(plannedId: 'pw-1', completedId: 'cw-1', deleted: true),
      ];
      final result = mergeForTest(planned, completed, matches);
      final key = DateTime.utc(2026, 6, 1);
      expect(result[key]!.length, 2);
    });

    test('workouts on different days land in separate buckets', () {
      final planned = [
        _pw(id: 'pw-1', date: '2026-06-01', sport: Sport.run),
        _pw(id: 'pw-2', date: '2026-06-03', sport: Sport.swim),
      ];
      final result = mergeForTest(planned, [], []);
      expect(result.length, 2);
      expect(result.containsKey(DateTime.utc(2026, 6, 1)), isTrue);
      expect(result.containsKey(DateTime.utc(2026, 6, 3)), isTrue);
    });

    test('sport is preserved on each ActivitySummary', () {
      final planned = [
        _pw(id: 'pw-1', date: '2026-06-01', sport: Sport.strength),
      ];
      final result = mergeForTest(planned, [], []);
      final summary = result[DateTime.utc(2026, 6, 1)]!.first;
      expect(summary.sport, Sport.strength);
    });

    test('ActivitySummary.isPlanned is true when only planned present', () {
      final planned = [_pw(id: 'pw-1', date: '2026-06-01', sport: Sport.run)];
      final result = mergeForTest(planned, [], []);
      final summary = result[DateTime.utc(2026, 6, 1)]!.first;
      expect(summary.isPlanned, isTrue);
      expect(summary.isCompleted, isFalse);
    });

    test('ActivitySummary.isCompleted is true when completed present', () {
      final completed = [
        _cw(
            id: 'cw-1',
            startedAt: _local(2026, 6, 1, 8, 0, 0),
            sport: Sport.run,
            durationS: 1800),
      ];
      final result = mergeForTest([], completed, []);
      final summary = result[DateTime.utc(2026, 6, 1)]!.first;
      expect(summary.isCompleted, isTrue);
    });
  });
}
