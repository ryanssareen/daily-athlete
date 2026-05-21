// lib/features/calendar/week_view.dart
//
// Two-week view (default): two stacked 7-column week cards (14 days total)
// showing sport-colored chips per day.
// Planned workouts use a soft tinted chip; completed use the full sport color.
// Long-press a planned workout chip → WorkoutActionSheet.
// Tapping an empty cell (coach) → opens AssignWorkoutSheet.
// Tapping a day → navigates to Day view for that date.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../models/activity_summary.dart';
import '../../models/user.dart';
import '../shell/role_notifier.dart';
import 'calendar_providers.dart';
import 'assign_workout_sheet.dart';
import 'workout_action_sheet.dart';
import 'workout_chip.dart';

/// Max workout chips rendered per day cell before collapsing into a "+N" pill.
const int _maxChipsPerDay = 3;

bool _isSameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

class WeekView extends ConsumerWidget {
  const WeekView({super.key, required this.onDayTapped});

  /// Called when the user taps a day — typically navigates to Day view.
  final void Function(DateTime date) onDayTapped;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final range = ref.watch(calendarWeekRangeProvider);
    final weekDataAsync = ref.watch(calendarWeekDataProvider);
    final roleAsync = ref.watch(roleNotifierProvider);

    // Build the 14 days for the current two-week range.
    final days = List.generate(14, (i) => range.start.add(Duration(days: i)));
    final firstWeek = days.sublist(0, 7);
    final secondWeek = days.sublist(7, 14);
    final isCoach = roleAsync.valueOrNull == RoleFlag.coach;

    return Column(
      children: [
        _WeekNavigation(range: range),
        Expanded(
          child: weekDataAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (err, _) => _ErrorState(message: '$err'),
            data: (weekMap) => ListView(
              physics: const BouncingScrollPhysics(
                parent: AlwaysScrollableScrollPhysics(),
              ),
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 96),
              children: [
                _WeekCard(
                  days: firstWeek,
                  weekMap: weekMap,
                  isCoach: isCoach,
                  onDayTapped: onDayTapped,
                ),
                const SizedBox(height: 12),
                _WeekCard(
                  days: secondWeek,
                  weekMap: weekMap,
                  isCoach: isCoach,
                  onDayTapped: onDayTapped,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// _WeekNavigation — previous / next 2-week controls + "Today" jump
// ---------------------------------------------------------------------------

class _WeekNavigation extends ConsumerWidget {
  const _WeekNavigation({required this.range});

  final ({DateTime start, DateTime end}) range;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final label = _weekLabel(range.start, range.end);
    final today = DateTime.now();
    // Whether "now" falls inside the visible 14-day window.
    final isCurrent = !today.isBefore(range.start) &&
        today.isBefore(range.end.add(const Duration(days: 1)));

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: Row(
        children: [
          _NavButton(
            icon: Icons.chevron_left,
            tooltip: 'Previous 2 weeks',
            onPressed: () => _shiftWeek(ref, -14),
          ),
          Expanded(
            child: Column(
              children: [
                Text(
                  label,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 150),
                  child: isCurrent
                      ? const SizedBox(height: 0, width: 0)
                      : Padding(
                          key: const ValueKey('today-jump'),
                          padding: const EdgeInsets.only(top: 2),
                          child: GestureDetector(
                            onTap: () => _jumpToToday(ref),
                            child: Text(
                              'Jump to today',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.primary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                ),
              ],
            ),
          ),
          _NavButton(
            icon: Icons.chevron_right,
            tooltip: 'Next 2 weeks',
            onPressed: () => _shiftWeek(ref, 14),
          ),
        ],
      ),
    );
  }

  void _shiftWeek(WidgetRef ref, int days) {
    final current = ref.read(calendarWeekRangeProvider);
    ref.read(calendarWeekRangeProvider.notifier).state = (
      start: current.start.add(Duration(days: days)),
      end: current.end.add(Duration(days: days)),
    );
  }

  void _jumpToToday(WidgetRef ref) {
    final now = DateTime.now();
    final monday = now.subtract(Duration(days: now.weekday - 1));
    final start = DateTime.utc(monday.year, monday.month, monday.day);
    ref.read(calendarWeekRangeProvider.notifier).state = (
      start: start,
      end: start.add(const Duration(days: 13)),
    );
  }

  String _weekLabel(DateTime start, DateTime end) {
    final fmt = DateFormat('MMM d');
    if (start.month == end.month) {
      return '${DateFormat('MMMM').format(start)} ${start.day}–${end.day}';
    }
    return '${fmt.format(start)} – ${fmt.format(end)}';
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return IconButton(
      icon: Icon(icon),
      tooltip: tooltip,
      onPressed: onPressed,
      visualDensity: VisualDensity.compact,
      style: IconButton.styleFrom(
        backgroundColor: theme.colorScheme.surfaceContainerHighest,
        foregroundColor: theme.colorScheme.onSurfaceVariant,
        shape: const CircleBorder(),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _WeekCard — flat tonal card holding a weekday header + 7 day cells
// ---------------------------------------------------------------------------

class _WeekCard extends StatelessWidget {
  const _WeekCard({
    required this.days,
    required this.weekMap,
    required this.isCoach,
    required this.onDayTapped,
  });

  final List<DateTime> days;
  final Map<DateTime, List<ActivitySummary>> weekMap;
  final bool isCoach;
  final void Function(DateTime date) onDayTapped;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Column(
          children: [
            _WeekdayHeader(days: days),
            Divider(
              height: 9,
              thickness: 1,
              color: theme.colorScheme.outlineVariant.withValues(alpha: 0.4),
            ),
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: days.map((day) {
                  final key = DateTime.utc(day.year, day.month, day.day);
                  return Expanded(
                    child: _DayCell(
                      date: day,
                      workouts: weekMap[key] ?? const [],
                      isCoach: isCoach,
                      onDayTapped: onDayTapped,
                    ),
                  );
                }).toList(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _WeekdayHeader — single-letter weekday labels aligned to the day columns
// ---------------------------------------------------------------------------

class _WeekdayHeader extends StatelessWidget {
  const _WeekdayHeader({required this.days});

  final List<DateTime> days;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: days.map((day) {
        final isWeekend = day.weekday == DateTime.saturday ||
            day.weekday == DateTime.sunday;
        return Expanded(
          child: Center(
            child: Text(
              DateFormat.E().format(day).substring(0, 1), // M T W …
              style: theme.textTheme.labelSmall?.copyWith(
                fontWeight: FontWeight.w700,
                letterSpacing: 0.5,
                color: isWeekend
                    ? theme.colorScheme.onSurfaceVariant
                        .withValues(alpha: 0.55)
                    : theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

// ---------------------------------------------------------------------------
// _DayCell — single day column: date badge + workout chips
// ---------------------------------------------------------------------------

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.date,
    required this.workouts,
    required this.isCoach,
    required this.onDayTapped,
  });

  final DateTime date;
  final List<ActivitySummary> workouts;
  final bool isCoach;
  final void Function(DateTime date) onDayTapped;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final isToday = _isSameDay(date, DateTime.now());
    final isWeekend = date.weekday == DateTime.saturday ||
        date.weekday == DateTime.sunday;
    final isEmpty = workouts.isEmpty;
    // Coaches can tap an empty cell to assign a workout; everyone can tap a
    // populated cell to open the Day view.
    final canTap = !isEmpty || isCoach;

    final visible = workouts.take(_maxChipsPerDay).toList();
    final overflow = workouts.length - visible.length;

    final cell = Container(
      margin: const EdgeInsets.symmetric(horizontal: 1.5),
      padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 6),
      decoration: BoxDecoration(
        color: isToday
            ? cs.primary.withValues(alpha: 0.06)
            : isWeekend
                ? cs.surfaceContainerHighest.withValues(alpha: 0.4)
                : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        border: isToday
            ? Border.all(color: cs.primary.withValues(alpha: 0.45), width: 1.2)
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _DateBadge(date: date, isToday: isToday),
          const SizedBox(height: 5),
          if (isEmpty)
            _EmptyDayAffordance(isCoach: isCoach)
          else ...[
            for (final s in visible) _chipForSummary(context, s),
            if (overflow > 0)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  '+$overflow',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: cs.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        ],
      ),
    );

    if (!canTap) return cell;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => isEmpty && isCoach
          ? _showAssignSheet(context, date)
          : onDayTapped(date),
      child: cell,
    );
  }

  Widget _chipForSummary(BuildContext context, ActivitySummary summary) {
    final pw = summary.planned;
    if (pw != null && !summary.isCompleted) {
      return WorkoutChip.fromSummary(
        summary,
        onTap: () => onDayTapped(date),
        onLongPress: () => showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          builder: (_) => WorkoutActionSheet(workout: pw),
        ),
      );
    }
    return WorkoutChip.fromSummary(
      summary,
      onTap: () => onDayTapped(date),
    );
  }

  void _showAssignSheet(BuildContext context, DateTime date) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => AssignWorkoutSheet(date: date),
    );
  }
}

// ---------------------------------------------------------------------------
// _DateBadge — the day-of-month number, highlighted red when it's today
// ---------------------------------------------------------------------------

class _DateBadge extends StatelessWidget {
  const _DateBadge({required this.date, required this.isToday});

  final DateTime date;
  final bool isToday;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    return Center(
      child: Container(
        width: 26,
        height: 26,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: isToday ? cs.primary : Colors.transparent,
          shape: BoxShape.circle,
        ),
        child: Text(
          '${date.day}',
          style: theme.textTheme.labelMedium?.copyWith(
            color: isToday ? cs.onPrimary : cs.onSurface,
            fontWeight: isToday ? FontWeight.w800 : FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// _EmptyDayAffordance — subtle placeholder for a day with no workouts
// ---------------------------------------------------------------------------

class _EmptyDayAffordance extends StatelessWidget {
  const _EmptyDayAffordance({required this.isCoach});

  final bool isCoach;

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Center(
      child: isCoach
          ? Icon(
              Icons.add_rounded,
              size: 16,
              color: cs.onSurfaceVariant.withValues(alpha: 0.45),
            )
          // A faint dash keeps each cell visually balanced even when empty.
          : Container(
              width: 10,
              height: 3,
              decoration: BoxDecoration(
                color: cs.outlineVariant.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
    );
  }
}

// ---------------------------------------------------------------------------
// _ErrorState — friendly inline error
// ---------------------------------------------------------------------------

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.cloud_off_rounded,
              size: 40,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 12),
            Text(
              "Couldn't load your calendar",
              style: theme.textTheme.titleSmall,
            ),
            const SizedBox(height: 4),
            Text(
              message,
              textAlign: TextAlign.center,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
