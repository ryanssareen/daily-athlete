// Pure view logic for the plan overview — derives what a plan *contains* from
// its planned workouts. The `plans` row itself carries only event/status/source,
// so everything an athlete cares about (span, weekly volume, sport mix, what's
// next) has to be computed here. No Flutter imports; unit-testable.

import '../../models/planned_structure.dart';
import '../../models/planned_workout.dart';
import '../../models/sport.dart';

class PlanWeek {
  PlanWeek(this.start);

  final DateTime start;
  int sessions = 0;
  int done = 0;
  double durationS = 0;
  double load = 0;
}

class PlanSummary {
  const PlanSummary({
    required this.weeks,
    required this.currentWeekIndex,
    required this.total,
    required this.done,
    required this.skipped,
    required this.sportSeconds,
    required this.next,
    required this.thisWeek,
  });

  final List<PlanWeek> weeks;
  final int? currentWeekIndex;
  final int total;
  final int done;
  final int skipped;
  final Map<Sport, double> sportSeconds;
  final PlannedWorkoutRow? next;
  final List<PlannedWorkoutRow> thisWeek;

  double get totalDurationS => weeks.fold(0, (sum, w) => sum + w.durationS);
}

DateTime _mondayOf(DateTime d) =>
    DateTime.utc(d.year, d.month, d.day).subtract(Duration(days: d.weekday - 1));

PlanSummary summarizePlan(List<PlannedWorkoutRow> workouts, DateTime today) {
  final sorted = [...workouts]..sort((a, b) => a.scheduledDate.compareTo(b.scheduledDate));
  final byWeek = <DateTime, PlanWeek>{};
  final sportSeconds = <Sport, double>{};
  var done = 0;
  var skipped = 0;

  for (final w in sorted) {
    final week = byWeek.putIfAbsent(_mondayOf(w.scheduledDate), () => PlanWeek(_mondayOf(w.scheduledDate)));
    final seconds = readStructureDurationSeconds(w.structure) ?? 0;
    week.sessions++;
    week.durationS += seconds;
    week.load += readStructureLoad(w.structure, w.plannedLoad) ?? 0;
    sportSeconds.update(w.sport, (v) => v + seconds, ifAbsent: () => seconds);
    if (w.status == PlannedWorkoutStatus.completed) {
      week.done++;
      done++;
    }
    if (w.status == PlannedWorkoutStatus.skipped) skipped++;
  }

  final weeks = byWeek.values.toList()..sort((a, b) => a.start.compareTo(b.start));
  final thisMonday = _mondayOf(today);
  final currentIdx = weeks.indexWhere((w) => w.start == thisMonday);
  final todayDate = DateTime.utc(today.year, today.month, today.day);

  return PlanSummary(
    weeks: weeks,
    currentWeekIndex: currentIdx == -1 ? null : currentIdx,
    total: sorted.length,
    done: done,
    skipped: skipped,
    sportSeconds: sportSeconds,
    next: sorted.cast<PlannedWorkoutRow?>().firstWhere(
          (w) =>
              w!.status == PlannedWorkoutStatus.planned &&
              !DateTime.utc(w.scheduledDate.year, w.scheduledDate.month, w.scheduledDate.day).isBefore(todayDate),
          orElse: () => null,
        ),
    thisWeek: sorted.where((w) => _mondayOf(w.scheduledDate) == thisMonday).toList(),
  );
}
