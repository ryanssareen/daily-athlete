import '../../models/activity_summary.dart';

/// One block of the week agenda: either a single day or a run of consecutive
/// empty past days collapsed into one "Rest" row.
sealed class AgendaBlock {
  const AgendaBlock();
}

class AgendaDay extends AgendaBlock {
  const AgendaDay({required this.index, required this.date, required this.workouts});

  /// 0 = Monday ... 6 = Sunday.
  final int index;
  final DateTime date;
  final List<ActivitySummary> workouts;
}

class AgendaRest extends AgendaBlock {
  const AgendaRest({required this.firstIndex, required this.dates});

  final int firstIndex;
  final List<DateTime> dates;

  int get count => dates.length;
}

/// Groups [days] (Monday..Sunday) into agenda blocks. Consecutive empty days
/// strictly before [today] collapse into one [AgendaRest]; empty days that are
/// today or later stay as their own [AgendaDay] so they can be assigned to.
List<AgendaBlock> buildAgenda(
  List<DateTime> days,
  Map<DateTime, List<ActivitySummary>> weekMap,
  DateTime today,
) {
  final todayDate = DateTime(today.year, today.month, today.day);
  final blocks = <AgendaBlock>[];
  var restDates = <DateTime>[];
  var restStart = 0;

  void flushRest() {
    if (restDates.isNotEmpty) {
      blocks.add(AgendaRest(firstIndex: restStart, dates: restDates));
      restDates = <DateTime>[];
    }
  }

  for (var i = 0; i < days.length; i++) {
    final d = days[i];
    final workouts = weekMap[DateTime.utc(d.year, d.month, d.day)] ?? const <ActivitySummary>[];
    final isPast = DateTime(d.year, d.month, d.day).isBefore(todayDate);
    if (workouts.isEmpty && isPast) {
      if (restDates.isEmpty) restStart = i;
      restDates.add(d);
    } else {
      flushRest();
      blocks.add(AgendaDay(index: i, date: d, workouts: workouts));
    }
  }
  flushRest();
  return blocks;
}
