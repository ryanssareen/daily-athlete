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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // -------------------------------------------------------------------------
  // aggregateYearHeatmap
  // -------------------------------------------------------------------------

  group('aggregateYearHeatmap', () {
    test('returns empty map for empty input', () {
      final result = aggregateYearHeatmap([]);
      expect(result, isEmpty);
    });

    test('sums duration_s for workouts on the same UTC day', () {
      final workouts = [
        _cw(
          id: 'cw-1',
          startedAt: '2026-06-01T08:00:00Z',
          sport: Sport.run,
          durationS: 3600,
        ),
        _cw(
          id: 'cw-2',
          startedAt: '2026-06-01T18:00:00Z',
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
            startedAt: '2026-06-01T08:00:00Z',
            sport: Sport.run,
            durationS: 3600),
        _cw(
            id: 'cw-2',
            startedAt: '2026-06-02T09:00:00Z',
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
            startedAt: '2026-06-01T08:00:00Z',
            sport: Sport.run,
            durationS: null),
        _cw(
            id: 'cw-2',
            startedAt: '2026-06-01T18:00:00Z',
            sport: Sport.strength,
            durationS: 1200),
      ];
      final result = aggregateYearHeatmap(workouts);
      expect(result[DateTime.utc(2026, 6, 1)], 1200);
    });

    test('timestamps at different times of the same UTC day share one bucket',
        () {
      final workouts = [
        _cw(
            id: 'cw-1',
            startedAt: '2026-06-01T00:00:00Z',
            sport: Sport.run,
            durationS: 100),
        _cw(
            id: 'cw-2',
            startedAt: '2026-06-01T23:59:59Z',
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
            startedAt: '2026-06-01T06:00:00Z',
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
      final result = mergeForTest([], []);
      expect(result, isEmpty);
    });

    test('planned workout appears on its scheduled date', () {
      final planned = [_pw(id: 'pw-1', date: '2026-06-01', sport: Sport.run)];
      final result = mergeForTest(planned, []);
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
            startedAt: '2026-06-01T08:00:00Z',
            sport: Sport.run,
            durationS: 3600),
      ];
      final result = mergeForTest([], completed);
      final key = DateTime.utc(2026, 6, 1);
      expect(result[key]!.length, 1);
      final summary = result[key]!.first;
      expect(summary.completed, isNotNull);
      expect(summary.planned, isNull);
    });

    test(
        'planned and completed on same day both appear — not deduplicated', () {
      final planned = [_pw(id: 'pw-1', date: '2026-06-01', sport: Sport.run)];
      final completed = [
        _cw(
            id: 'cw-1',
            startedAt: '2026-06-01T08:00:00Z',
            sport: Sport.run,
            durationS: 3600),
      ];
      final result = mergeForTest(planned, completed);
      final key = DateTime.utc(2026, 6, 1);
      // Both planned AND completed should appear as separate ActivitySummary items.
      expect(result[key]!.length, 2);
    });

    test('workouts on different days land in separate buckets', () {
      final planned = [
        _pw(id: 'pw-1', date: '2026-06-01', sport: Sport.run),
        _pw(id: 'pw-2', date: '2026-06-03', sport: Sport.swim),
      ];
      final result = mergeForTest(planned, []);
      expect(result.length, 2);
      expect(result.containsKey(DateTime.utc(2026, 6, 1)), isTrue);
      expect(result.containsKey(DateTime.utc(2026, 6, 3)), isTrue);
    });

    test('sport is preserved on each ActivitySummary', () {
      final planned = [
        _pw(id: 'pw-1', date: '2026-06-01', sport: Sport.strength),
      ];
      final result = mergeForTest(planned, []);
      final summary = result[DateTime.utc(2026, 6, 1)]!.first;
      expect(summary.sport, Sport.strength);
    });

    test('ActivitySummary.isPlanned is true when only planned present', () {
      final planned = [_pw(id: 'pw-1', date: '2026-06-01', sport: Sport.run)];
      final result = mergeForTest(planned, []);
      final summary = result[DateTime.utc(2026, 6, 1)]!.first;
      expect(summary.isPlanned, isTrue);
      expect(summary.isCompleted, isFalse);
    });

    test('ActivitySummary.isCompleted is true when completed present', () {
      final completed = [
        _cw(
            id: 'cw-1',
            startedAt: '2026-06-01T08:00:00Z',
            sport: Sport.run,
            durationS: 1800),
      ];
      final result = mergeForTest([], completed);
      final summary = result[DateTime.utc(2026, 6, 1)]!.first;
      expect(summary.isCompleted, isTrue);
    });
  });
}
