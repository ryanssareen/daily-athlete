// lib/features/calendar/week_view.dart
//
// Week view (default): 7-column grid showing sport-colored chips per day.
// Planned workouts use a lighter shade; completed use the full sport color.
// Long-press a planned workout chip → WorkoutActionSheet.
// Tapping an empty cell (coach) → opens AssignWorkoutSheet.
// Tapping a day header → navigates to Day view for that date.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../models/activity_summary.dart';
import '../shell/role_notifier.dart';
import 'calendar_providers.dart';
import 'assign_workout_sheet.dart';
import 'workout_action_sheet.dart';
import 'workout_chip.dart';

class WeekView extends ConsumerWidget {
  const WeekView({super.key, required this.onDayTapped});

  /// Called when the user taps a day header — typically navigates to Day view.
  final void Function(DateTime date) onDayTapped;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final range = ref.watch(calendarWeekRangeProvider);
    final weekDataAsync = ref.watch(calendarWeekDataProvider);
    final roleAsync = ref.watch(roleNotifierProvider);

    // Build the 7 days for the current week range.
    final days = List.generate(
      7,
      (i) => range.start.add(Duration(days: i)),
    );

    return Column(
      children: [
        _WeekNavigation(range: range),
        const Divider(height: 1),
        Expanded(
          child: weekDataAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (err, _) => Center(child: Text('Error: $err')),
            data: (weekMap) => _WeekGrid(
              days: days,
              weekMap: weekMap,
              isCoach: roleAsync.valueOrNull == RoleFlag.coach,
              onDayTapped: onDayTapped,
            ),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// _WeekNavigation — previous / next week controls
// ---------------------------------------------------------------------------

class _WeekNavigation extends ConsumerWidget {
  const _WeekNavigation({required this.range});

  final ({DateTime start, DateTime end}) range;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final label = _weekLabel(range.start, range.end);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.chevron_left),
            tooltip: 'Previous week',
            onPressed: () => _shiftWeek(ref, -7),
          ),
          Expanded(
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          IconButton(
            icon: const Icon(Icons.chevron_right),
            tooltip: 'Next week',
            onPressed: () => _shiftWeek(ref, 7),
          ),
        ],
      ),
    );
  }

  void _shiftWeek(WidgetRef ref, int days) {
    final current = ref.read(calendarWeekRangeProvider);
    final newStart = current.start.add(Duration(days: days));
    final newEnd = current.end.add(Duration(days: days));
    ref.read(calendarWeekRangeProvider.notifier).state =
        (start: newStart, end: newEnd);
  }

  String _weekLabel(DateTime start, DateTime end) {
    final fmt = DateFormat('MMM d');
    if (start.month == end.month) {
      return '${DateFormat('MMMM').format(start)} ${start.day}–${end.day}, ${start.year}';
    }
    return '${fmt.format(start)} – ${fmt.format(end)}, ${start.year}';
  }
}

// ---------------------------------------------------------------------------
// _WeekGrid — 7-column grid of day cells
// ---------------------------------------------------------------------------

class _WeekGrid extends StatelessWidget {
  const _WeekGrid({
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
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: days.map((day) {
        final key = DateTime.utc(day.year, day.month, day.day);
        final workouts = weekMap[key] ?? [];
        return Expanded(
          child: _DayColumn(
            date: day,
            workouts: workouts,
            isCoach: isCoach,
            onDayTapped: onDayTapped,
          ),
        );
      }).toList(),
    );
  }
}

// ---------------------------------------------------------------------------
// _DayColumn — single day cell within the week grid
// ---------------------------------------------------------------------------

class _DayColumn extends StatelessWidget {
  const _DayColumn({
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
    final now = DateTime.now();
    final isToday = date.year == now.year &&
        date.month == now.month &&
        date.day == now.day;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        // Day-of-week label + day number
        GestureDetector(
          onTap: () => onDayTapped(date),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Column(
              children: [
                Text(
                  DateFormat.E().format(date), // Mon, Tue…
                  style: theme.textTheme.labelSmall,
                ),
                const SizedBox(height: 2),
                CircleAvatar(
                  radius: 13,
                  backgroundColor: isToday
                      ? theme.colorScheme.primary
                      : Colors.transparent,
                  child: Text(
                    '${date.day}',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: isToday
                          ? theme.colorScheme.onPrimary
                          : theme.colorScheme.onSurface,
                      fontWeight: isToday ? FontWeight.bold : null,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const Divider(height: 1),

        // Workout chips
        GestureDetector(
          // Coach: tap empty cell to assign
          onTap: isCoach && workouts.isEmpty
              ? () => _showAssignSheet(context, date)
              : null,
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 4),
            color: Colors.transparent,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: workouts.isEmpty
                  ? [
                      if (isCoach)
                        Icon(
                          Icons.add,
                          size: 16,
                          color: theme.colorScheme.onSurface
                              .withValues(alpha: 0.3),
                        ),
                    ]
                  : workouts.map((s) => _chipForSummary(context, s)).toList(),
            ),
          ),
        ),
      ],
    );
  }

  Widget _chipForSummary(BuildContext context, ActivitySummary summary) {
    final pw = summary.planned;
    if (pw != null && !summary.isCompleted) {
      return WorkoutChip.fromSummary(
        summary,
        onLongPress: () => showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          builder: (_) => WorkoutActionSheet(workout: pw),
        ),
      );
    }
    return WorkoutChip.fromSummary(summary);
  }

  void _showAssignSheet(BuildContext context, DateTime date) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => AssignWorkoutSheet(date: date),
    );
  }
}
