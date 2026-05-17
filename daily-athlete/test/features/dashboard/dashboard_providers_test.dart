import 'package:daily_athlete/features/dashboard/dashboard_providers.dart';
import 'package:daily_athlete/models/completed_workout.dart';
import 'package:daily_athlete/models/planned_workout.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:flutter_test/flutter_test.dart';

// ---------------------------------------------------------------------------
// Helpers for building test fixture rows
// ---------------------------------------------------------------------------

CompletedWorkoutRow _makeCompleted({
  String id = 'cw-1',
  String athleteId = 'user-1',
  required DateTime startedAt,
  Sport sport = Sport.run,
  double? distanceM,
  int? durationS,
}) {
  return CompletedWorkoutRow(
    id: id,
    athleteId: athleteId,
    source: CompletedWorkoutSource.manual,
    startedAt: startedAt,
    sport: sport,
    summaryStats: const {},
    distanceM: distanceM,
    durationS: durationS,
  );
}

PlannedWorkoutRow _makePlanned({
  String id = 'pw-1',
  String athleteId = 'user-1',
  required DateTime scheduledDate,
  Sport sport = Sport.run,
  PlannedWorkoutStatus status = PlannedWorkoutStatus.planned,
  DateTime? deletedAt,
}) {
  return PlannedWorkoutRow(
    id: id,
    athleteId: athleteId,
    scheduledDate: scheduledDate,
    sport: sport,
    structure: const {},
    status: status,
    deletedAt: deletedAt,
  );
}

// ---------------------------------------------------------------------------
// weekStart / weekEnd helpers
// ---------------------------------------------------------------------------

void main() {
  group('weekStart', () {
    test('returns Monday for a Wednesday', () {
      final wednesday = DateTime.utc(2026, 5, 13); // Wed
      final result = weekStart(wednesday);
      expect(result.weekday, DateTime.monday);
      expect(result, DateTime.utc(2026, 5, 11));
    });

    test('returns same day for a Monday', () {
      final monday = DateTime.utc(2026, 5, 11);
      final result = weekStart(monday);
      expect(result, DateTime.utc(2026, 5, 11));
    });

    test('returns Monday for a Sunday', () {
      final sunday = DateTime.utc(2026, 5, 17);
      final result = weekStart(sunday);
      expect(result, DateTime.utc(2026, 5, 11));
    });
  });

  group('weekEnd', () {
    test('returns Sunday evening for any day in the same week', () {
      final wednesday = DateTime.utc(2026, 5, 13);
      final result = weekEnd(wednesday);
      expect(result.weekday, DateTime.sunday);
      expect(result.year, 2026);
      expect(result.month, 5);
      expect(result.day, 17);
    });
  });

  // ---------------------------------------------------------------------------
  // totalDurationS / totalHours
  // ---------------------------------------------------------------------------

  group('totalDurationS', () {
    test('sums duration_s across workouts', () {
      final workouts = [
        _makeCompleted(startedAt: DateTime.utc(2026, 5, 12), durationS: 3600),
        _makeCompleted(
            id: 'cw-2',
            startedAt: DateTime.utc(2026, 5, 13),
            durationS: 1800),
      ];
      expect(totalDurationS(workouts), 5400);
    });

    test('treats null duration_s as zero', () {
      final workouts = [
        _makeCompleted(startedAt: DateTime.utc(2026, 5, 12), durationS: null),
        _makeCompleted(
            id: 'cw-2',
            startedAt: DateTime.utc(2026, 5, 13),
            durationS: 7200),
      ];
      expect(totalDurationS(workouts), 7200);
    });

    test('returns 0 for empty list', () {
      expect(totalDurationS([]), 0);
    });
  });

  group('totalHours', () {
    test('converts seconds to fractional hours correctly', () {
      final workouts = [
        _makeCompleted(startedAt: DateTime.utc(2026, 5, 12), durationS: 5400),
      ];
      expect(totalHours(workouts), closeTo(1.5, 0.0001));
    });

    test('returns 0.0 for empty list', () {
      expect(totalHours([]), 0.0);
    });
  });

  // ---------------------------------------------------------------------------
  // distanceBySport
  // ---------------------------------------------------------------------------

  group('distanceBySport', () {
    test('sums distances grouped by sport', () {
      final workouts = [
        _makeCompleted(
            startedAt: DateTime.utc(2026, 5, 12),
            sport: Sport.run,
            distanceM: 5000),
        _makeCompleted(
            id: 'cw-2',
            startedAt: DateTime.utc(2026, 5, 13),
            sport: Sport.run,
            distanceM: 3000),
        _makeCompleted(
            id: 'cw-3',
            startedAt: DateTime.utc(2026, 5, 14),
            sport: Sport.bike,
            distanceM: 20000),
      ];
      final result = distanceBySport(workouts);
      expect(result[Sport.run], closeTo(8000, 0.01));
      expect(result[Sport.bike], closeTo(20000, 0.01));
      expect(result.containsKey(Sport.swim), isFalse);
    });

    test('ignores null and zero distances', () {
      final workouts = [
        _makeCompleted(
            startedAt: DateTime.utc(2026, 5, 12),
            sport: Sport.strength,
            distanceM: null),
        _makeCompleted(
            id: 'cw-2',
            startedAt: DateTime.utc(2026, 5, 13),
            sport: Sport.run,
            distanceM: 0),
        _makeCompleted(
            id: 'cw-3',
            startedAt: DateTime.utc(2026, 5, 14),
            sport: Sport.run,
            distanceM: 10000),
      ];
      final result = distanceBySport(workouts);
      expect(result.containsKey(Sport.strength), isFalse);
      expect(result[Sport.run], closeTo(10000, 0.01));
    });

    test('returns empty map for empty list', () {
      expect(distanceBySport([]), isEmpty);
    });
  });

  // ---------------------------------------------------------------------------
  // calculateStreak
  // ---------------------------------------------------------------------------

  group('calculateStreak', () {
    final today = DateTime(2026, 5, 17); // Sunday

    test('returns 0 when no workouts exist', () {
      expect(calculateStreak([], today), 0);
    });

    test('returns 0 when today has no workout', () {
      final dates = [
        DateTime(2026, 5, 15, 8),
        DateTime(2026, 5, 16, 9),
      ];
      expect(calculateStreak(dates, today), 0);
    });

    test('returns 1 when only today has a workout', () {
      final dates = [DateTime(2026, 5, 17, 7)];
      expect(calculateStreak(dates, today), 1);
    });

    test('counts consecutive days correctly', () {
      final dates = [
        DateTime(2026, 5, 14, 8), // Thu
        DateTime(2026, 5, 15, 9), // Fri
        DateTime(2026, 5, 16, 7), // Sat
        DateTime(2026, 5, 17, 6), // Sun (today)
      ];
      expect(calculateStreak(dates, today), 4);
    });

    test('stops at a gap in the streak', () {
      final dates = [
        DateTime(2026, 5, 13, 8), // Wed — gap before Thu
        DateTime(2026, 5, 15, 9), // Fri
        DateTime(2026, 5, 16, 7), // Sat
        DateTime(2026, 5, 17, 6), // Sun (today)
      ];
      // streak = today(Sun), Sat, Fri — stops because Thu is missing
      expect(calculateStreak(dates, today), 3);
    });

    test('multiple workouts on the same day count as one streak day', () {
      final dates = [
        DateTime(2026, 5, 17, 6),
        DateTime(2026, 5, 17, 18), // second workout same day
        DateTime(2026, 5, 16, 7),
      ];
      expect(calculateStreak(dates, today), 2);
    });
  });

  // ---------------------------------------------------------------------------
  // nextUpcomingWorkout
  // ---------------------------------------------------------------------------

  group('nextUpcomingWorkout', () {
    final today = DateTime(2026, 5, 17, 10, 0, 0);

    test('returns null when list is empty', () {
      expect(nextUpcomingWorkout([], today), isNull);
    });

    test('returns null when all workouts are in the past', () {
      final workouts = [
        _makePlanned(
            id: 'pw-1',
            scheduledDate: DateTime(2026, 5, 10),
            status: PlannedWorkoutStatus.planned),
      ];
      expect(nextUpcomingWorkout(workouts, today), isNull);
    });

    test('returns null when status is not planned (e.g. completed)', () {
      final workouts = [
        _makePlanned(
            id: 'pw-1',
            scheduledDate: DateTime(2026, 5, 18),
            status: PlannedWorkoutStatus.completed),
      ];
      expect(nextUpcomingWorkout(workouts, today), isNull);
    });

    test('returns null for soft-deleted workouts', () {
      final workouts = [
        _makePlanned(
          id: 'pw-1',
          scheduledDate: DateTime(2026, 5, 18),
          status: PlannedWorkoutStatus.planned,
          deletedAt: DateTime(2026, 5, 16),
        ),
      ];
      expect(nextUpcomingWorkout(workouts, today), isNull);
    });

    test('returns today\'s workout when today has a planned workout', () {
      final workouts = [
        _makePlanned(
            id: 'pw-today',
            scheduledDate: DateTime(2026, 5, 17),
            status: PlannedWorkoutStatus.planned),
      ];
      final result = nextUpcomingWorkout(workouts, today);
      expect(result, isNotNull);
      expect(result!.id, 'pw-today');
    });

    test('returns earliest future workout from multiple candidates', () {
      final workouts = [
        _makePlanned(
            id: 'pw-far',
            scheduledDate: DateTime(2026, 5, 25),
            status: PlannedWorkoutStatus.planned),
        _makePlanned(
            id: 'pw-near',
            scheduledDate: DateTime(2026, 5, 18),
            status: PlannedWorkoutStatus.planned),
        _makePlanned(
            id: 'pw-past',
            scheduledDate: DateTime(2026, 5, 10),
            status: PlannedWorkoutStatus.planned),
      ];
      final result = nextUpcomingWorkout(workouts, today);
      expect(result?.id, 'pw-near');
    });
  });

  // ---------------------------------------------------------------------------
  // WeeklyStats empty-state
  // ---------------------------------------------------------------------------

  group('WeeklyStats empty state', () {
    test('zero workouts yields zero stats without crashing', () {
      const stats = WeeklyStats(
        totalHours: 0.0,
        distanceBySport: {},
        plannedCount: 0,
        completedCount: 0,
      );
      expect(stats.totalHours, 0.0);
      expect(stats.distanceBySport, isEmpty);
      expect(stats.compliancePct, 0.0);
    });

    test('compliancePct is 0 when plannedCount is 0 (no division by zero)', () {
      const stats = WeeklyStats(
        totalHours: 0.0,
        distanceBySport: {},
        plannedCount: 0,
        completedCount: 0,
      );
      expect(stats.compliancePct, 0.0);
    });

    test('compliancePct computes correctly when planned > 0', () {
      const stats = WeeklyStats(
        totalHours: 3.0,
        distanceBySport: {},
        plannedCount: 4,
        completedCount: 3,
      );
      expect(stats.compliancePct, closeTo(0.75, 0.0001));
    });
  });
}
