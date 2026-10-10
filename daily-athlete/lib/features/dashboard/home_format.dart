import '../../models/completed_workout.dart';
import '../../models/sport.dart';
import '../shared/day_strip.dart';

const _weekdayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// Seconds as h:mm, e.g. 20940 -> "5:49".
String fmtHm(int seconds) {
  final minutes = (seconds / 60).round();
  final h = minutes ~/ 60;
  final m = minutes % 60;
  return '$h:${m.toString().padLeft(2, '0')}';
}

/// "Fri 9 Oct".
String fmtDayDate(DateTime d) =>
    '${_weekdayShort[d.weekday - 1]} ${d.day} ${_monthShort[d.month - 1]}';

/// "Today" for the current local day, else "Fri 9 Oct".
String relativeDayLabel(DateTime started, DateTime now) {
  final s = started.toLocal();
  if (s.year == now.year && s.month == now.month && s.day == now.day) return 'Today';
  return fmtDayDate(s);
}

/// "Oct 5–11" for the Monday-start week containing [now].
String weekRangeLabel(DateTime now) {
  final monday = DateTime(now.year, now.month, now.day).subtract(Duration(days: now.weekday - 1));
  final sunday = monday.add(const Duration(days: 6));
  final start = '${_monthShort[monday.month - 1]} ${monday.day}';
  return monday.month == sunday.month
      ? '$start–${sunday.day}'
      : '$start – ${_monthShort[sunday.month - 1]} ${sunday.day}';
}

/// Monday..Sunday strip for the week containing [now], one dot per sport done.
List<DayStripDay> buildWeekStrip(List<CompletedWorkoutRow> completed, DateTime now) {
  final today = DateTime(now.year, now.month, now.day);
  final monday = today.subtract(Duration(days: now.weekday - 1));
  return List.generate(7, (i) {
    final day = monday.add(Duration(days: i));
    final sports = <Sport>[];
    for (final w in completed) {
      final s = w.startedAt.toLocal();
      if (s.year == day.year && s.month == day.month && s.day == day.day && !sports.contains(w.sport)) {
        sports.add(w.sport);
      }
    }
    return DayStripDay(
      letter: 'MTWTFSS'[i],
      dayNumber: day.day,
      sports: sports,
      isToday: day == today,
    );
  });
}

/// Seconds per sport, largest first.
List<MapEntry<Sport, int>> timeBySport(List<CompletedWorkoutRow> completed) {
  final totals = <Sport, int>{};
  for (final w in completed) {
    final s = w.durationS ?? 0;
    if (s > 0) totals[w.sport] = (totals[w.sport] ?? 0) + s;
  }
  return totals.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
}

/// Whole days from today's local date to [date] (negative when past).
int daysUntilDate(DateTime date, DateTime now) {
  final a = DateTime(now.year, now.month, now.day);
  final b = DateTime(date.year, date.month, date.day);
  return b.difference(a).inDays;
}

/// Device-clock greeting used when the server greeting is unavailable.
String localGreeting(DateTime now) {
  if (now.hour < 12) return 'Good morning';
  if (now.hour < 17) return 'Good afternoon';
  return 'Good evening';
}

String signed1(double v) {
  final r = (v * 10).round() / 10;
  final sign = r > 0 ? '+' : (r < 0 ? '−' : '');
  return '$sign${r.abs().toStringAsFixed(1)}';
}
