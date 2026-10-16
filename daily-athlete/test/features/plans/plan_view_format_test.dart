import 'package:daily_athlete/features/plans/plan_view_format.dart';
import 'package:daily_athlete/models/plan_view.dart';
import 'package:daily_athlete/models/workout_report.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('verdict chip labels', () {
    expect(verdictChipLabel(VerdictCode.executedAsPrescribed), 'As prescribed');
    expect(verdictChipLabel(VerdictCode.underExecuted), 'Under');
    expect(verdictChipLabel(VerdictCode.overExecuted), 'Over');
    expect(verdictChipLabel(VerdictCode.partialData), 'Partial data');
    expect(verdictChipLabel(VerdictCode.unplannedEffort), 'Unplanned');
  });

  test('compliance bar clamps and percent text', () {
    expect(complianceBarFraction(null), 0);
    expect(complianceBarFraction(0.75), 0.75);
    expect(complianceBarFraction(1.4), 1);
    expect(compliancePercentText(null), 'Not yet due');
    expect(compliancePercentText(0.754), '75%');
    expect(compliancePercentText(1.06), '106%');
    expect(isAheadOfPlan(1.06), isTrue);
    expect(isAheadOfPlan(1.0), isFalse);
    expect(isAheadOfPlan(null), isFalse);
  });

  test('phase labels', () {
    expect(phaseLabel(null), isNull);
    expect(phaseLabel(PlanPhase.build), 'Build');
    expect(phaseLabel(PlanPhase.recovery), 'Recovery');
    expect(phaseLabel(PlanPhase.peak), 'Peak');
    expect(phaseLabel(PlanPhase.taper), 'Taper');
  });

  test('hours and skipped text', () {
    expect(hoursExecutedOfPlanned(22800, 25200), '6h 20m of 7h 0m');
    expect(skippedText(0), isNull);
    expect(skippedText(2), '2 skipped');
  });

  test('compliance semantics', () {
    expect(complianceSemantics(0.75, 10800, 14400), contains('75%'));
    expect(complianceSemantics(null, 0, 0), 'Nothing due yet');
  });

  test('forecast date labels', () {
    expect(endOfBlockLabel(DateTime(2026, 11, 8)), 'End of block, Nov 8');
    expect(eventDayLabel(DateTime(2026, 11, 9)), 'On Nov 9');
  });

  test('week empty state', () {
    final empty = _week(sessions: 0, completed: 0, due: 0);
    expect(weekEmptyMessage(empty, hasVerdictError: false), 'No workouts scheduled yet');
    final noResults = _week(sessions: 2, completed: 0, due: 3600, current: true);
    expect(weekEmptyMessage(noResults, hasVerdictError: false), 'Results appear as you complete sessions');
    final nothingDue = _week(sessions: 2, completed: 0, due: 0, start: '2026-09-01');
    expect(weekEmptyMessage(nothingDue, hasVerdictError: false), 'Nothing was due this week');
  });
}

PlanViewWeek _week({required int sessions, required int completed, required double due, bool current = false, String start = '2026-10-12'}) {
  return PlanViewWeek.fromJson({
    'start': start,
    'phase': null,
    'focus': 'x',
    'plannedSeconds': 3600,
    'executedSeconds': 0,
    'dueSeconds': due,
    'compliance': null,
    'skippedCount': 0,
    'current': current,
    'sessions': [
      for (var i = 0; i < sessions; i++)
        {
          'id': 's$i',
          'date': '2026-10-13',
          'sport': 'run',
          'plannedSeconds': 1800,
          'plannedLoad': null,
          'intensity': null,
          'rationale': null,
          'status': i < completed ? 'completed' : 'planned',
          'verdict': null,
        },
    ],
  });
}
