import 'package:intl/intl.dart';

import '../../models/plan_view.dart';
import '../../models/workout_report.dart' show VerdictCode;
import '../reports/reports_view.dart' show formatDuration;

String verdictChipLabel(VerdictCode code) => switch (code) {
      VerdictCode.executedAsPrescribed => 'As prescribed',
      VerdictCode.underExecuted => 'Under',
      VerdictCode.overExecuted => 'Over',
      VerdictCode.partialData => 'Partial data',
      VerdictCode.unplannedEffort => 'Unplanned',
    };

double complianceBarFraction(double? compliance) =>
    compliance == null ? 0 : compliance.clamp(0.0, 1.0);

String compliancePercentText(double? compliance) =>
    compliance == null ? 'Not yet due' : '${(compliance * 100).round()}%';

bool isAheadOfPlan(double? compliance) => compliance != null && compliance > 1;

String? phaseLabel(PlanPhase? phase) => switch (phase) {
      null => null,
      PlanPhase.build => 'Build',
      PlanPhase.recovery => 'Recovery',
      PlanPhase.peak => 'Peak',
      PlanPhase.taper => 'Taper',
    };

String hoursExecutedOfPlanned(double executedSeconds, double plannedSeconds) =>
    '${formatDuration(executedSeconds)} of ${formatDuration(plannedSeconds)}';

String? skippedText(int skippedCount) => skippedCount > 0 ? '$skippedCount skipped' : null;

String weekLabel(DateTime start) => 'Week of ${DateFormat.MMMd().format(start)}';

String complianceSemantics(double? compliance, double executedSeconds, double dueSeconds) {
  if (compliance == null) return 'Nothing due yet';
  return '${formatDuration(executedSeconds)} of ${formatDuration(dueSeconds)} due so far, '
      '${compliancePercentText(compliance)}';
}

String endOfBlockLabel(DateTime date) => 'End of block, ${DateFormat.MMMd().format(date)}';

String eventDayLabel(DateTime date) => 'On ${DateFormat.MMMd().format(date)}';

String formatSigned(double value) {
  final rounded = value.round();
  return rounded > 0 ? '+$rounded' : '$rounded';
}

const noWorkoutsCopy = 'No workouts scheduled yet';

String? weekEmptyMessage(PlanViewWeek week, {required bool hasVerdictError, DateTime? now}) {
  if (week.sessions.isEmpty) return noWorkoutsCopy;
  if (week.dueSeconds > 0) {
    final anyCompleted = week.sessions.any((s) => s.status == PlanSessionStatus.completed);
    if (!anyCompleted && !hasVerdictError) return 'Results appear as you complete sessions';
    return null;
  }
  final today = now ?? DateTime.now();
  final weekEnd = week.start.add(const Duration(days: 7));
  if (!week.current && !weekEnd.isAfter(DateTime(today.year, today.month, today.day))) {
    return 'Nothing was due this week';
  }
  return null;
}

String sessionMeta(PlanViewSession session) {
  final seconds = session.plannedSeconds;
  return [
    DateFormat('EEE, MMM d').format(session.date),
    if (seconds != null && seconds > 0) formatDuration(seconds),
    if (session.intensity != null && session.intensity!.isNotEmpty) session.intensity!,
  ].join(' · ');
}
