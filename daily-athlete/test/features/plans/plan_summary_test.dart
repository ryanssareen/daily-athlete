import 'package:daily_athlete/features/plans/plan_summary.dart';
import 'package:daily_athlete/models/planned_workout.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:flutter_test/flutter_test.dart';

PlannedWorkoutRow _w(String date, Sport sport, int durationS, {PlannedWorkoutStatus status = PlannedWorkoutStatus.planned}) =>
    PlannedWorkoutRow(
      id: date + sport.name,
      athleteId: 'a',
      scheduledDate: DateTime.parse(date),
      sport: sport,
      structure: {'duration_s': durationS},
      status: status,
    );

void main() {
  test('groups by ISO week, totals volume and finds the next session', () {
    final summary = summarizePlan([
      _w('2026-10-12', Sport.run, 3600, status: PlannedWorkoutStatus.completed),
      _w('2026-10-14', Sport.bike, 5400),
      _w('2026-10-20', Sport.run, 1800),
    ], DateTime.utc(2026, 10, 13));

    expect(summary.weeks.length, 2);
    expect(summary.currentWeekIndex, 0);
    expect(summary.done, 1);
    expect(summary.weeks.first.durationS, 9000);
    expect(summary.sportSeconds[Sport.run], 5400);
    expect(summary.next?.sport, Sport.bike);
    expect(summary.thisWeek.length, 2);
  });
}
