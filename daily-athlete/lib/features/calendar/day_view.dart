// lib/features/calendar/day_view.dart
//
// Day view: scrollable list of workouts for the selected date.
// Displays full planned workout details from structure JSONB,
// or completed workout stats for completed activities.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/units.dart';
import '../../models/activity_summary.dart';
import '../../models/planned_workout.dart';
import '../../models/sport.dart';
import '../activities/activity_row.dart';
import '../settings/units_notifier.dart';
import 'calendar_providers.dart';
import 'workout_action_sheet.dart';
import 'workout_chip.dart';

// ---------------------------------------------------------------------------
// DayView
// ---------------------------------------------------------------------------

class DayView extends ConsumerWidget {
  const DayView({super.key, this.date});

  /// The date to display. If null, uses [selectedDateProvider].
  final DateTime? date;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final DateTime displayDate = date ?? ref.watch(selectedDateProvider);
    // Ensure the week range covers the display date so weekDataProvider
    // fetches the right data.
    _ensureWeekCovers(ref, displayDate);

    final workoutsAsync = ref.watch(dayWorkoutsProvider);

    return workoutsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(child: Text('Error: $err')),
      data: (workouts) => _DayContent(date: displayDate, workouts: workouts),
    );
  }

  void _ensureWeekCovers(WidgetRef ref, DateTime date) {
    final range = ref.read(calendarWeekRangeProvider);
    if (!date.isBefore(range.start) && !date.isAfter(range.end)) return;
    // Shift the two-week range so it starts on the Monday of the date's week
    // and spans 14 days, keeping it consistent with the 2 Weeks view.
    final weekday = date.weekday;
    final monday = date.subtract(Duration(days: weekday - 1));
    final start = DateTime.utc(monday.year, monday.month, monday.day);
    final end = start.add(const Duration(days: 13));
    ref.read(calendarWeekRangeProvider.notifier).state =
        (start: start, end: end);
  }
}

class _DayContent extends StatelessWidget {
  const _DayContent({required this.date, required this.workouts});

  final DateTime date;
  final List<ActivitySummary> workouts;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dateLabel =
        DateFormat.yMMMMEEEEd().format(date); // e.g. "Monday, 19 May 2026"

    return CustomScrollView(
      slivers: [
        SliverToBoxAdapter(
          child: Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Text(
              dateLabel,
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
          ),
        ),
        if (workouts.isEmpty)
          const SliverFillRemaining(
            child: Center(
              child: Text(
                'No workouts scheduled for this day.',
                textAlign: TextAlign.center,
              ),
            ),
          )
        else
          SliverList(
            delegate: SliverChildBuilderDelegate(
              (context, i) => _WorkoutCard(summary: workouts[i]),
              childCount: workouts.length,
            ),
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// _WorkoutCard — full-detail card for a single workout in Day view
// ---------------------------------------------------------------------------

class _WorkoutCard extends ConsumerWidget {
  const _WorkoutCard({required this.summary});

  final ActivitySummary summary;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final prefs =
        ref.watch(unitsNotifierProvider).valueOrNull ?? const UnitsPrefs();
    final pw = summary.planned;
    final cw = summary.completed;
    final metric = cw != null ? keyMetricFor(cw, prefs) : '';

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onLongPress: pw != null && !summary.isCompleted
            ? () => _showActionSheet(context, pw)
            : null,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row: chip + title
              Row(
                children: [
                  WorkoutChip(
                    sport: summary.sport,
                    isCompleted: summary.isCompleted,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      summary.title,
                      style: theme.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w600),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              if (pw != null) ...[
                const SizedBox(height: 8),
                _PlannedDetails(workout: pw, prefs: prefs),
              ],
              if (cw != null) ...[
                const SizedBox(height: 8),
                _CompletedDetails(
                  distanceM: cw.distanceM,
                  durationS: cw.durationS,
                  sport: cw.sport,
                  prefs: prefs,
                ),
              ],
              if (metric.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  metric,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.secondary,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _showActionSheet(BuildContext context, PlannedWorkoutRow pw) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => WorkoutActionSheet(workout: pw),
    );
  }
}

class _PlannedDetails extends StatelessWidget {
  const _PlannedDetails({required this.workout, required this.prefs});

  final PlannedWorkoutRow workout;
  final UnitsPrefs prefs;

  @override
  Widget build(BuildContext context) {
    final structure = workout.structure;
    final items = <String>[];

    if (structure['description'] != null) {
      items.add(structure['description'] as String);
    }
    if (structure['duration_s'] != null) {
      final s = structure['duration_s'] as int;
      items.add('Target: ${_formatDuration(s)}');
    }
    if (structure['distance_m'] != null) {
      final m = (structure['distance_m'] as num).toDouble();
      items.add('Distance: ${formatDistance(m, prefs, workout.sport)}');
    }
    if (workout.rationale != null) {
      items.add(workout.rationale!);
    }

    if (items.isEmpty) {
      items.add('${workout.sport.displayName} workout');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: items
          .map(
            (s) => Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(s,
                  style: Theme.of(context).textTheme.bodySmall),
            ),
          )
          .toList(),
    );
  }

  static String _formatDuration(int seconds) {
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    if (h > 0) return '${h}h ${m}m';
    return '${m}m';
  }
}

class _CompletedDetails extends StatelessWidget {
  const _CompletedDetails({
    this.distanceM,
    this.durationS,
    required this.sport,
    required this.prefs,
  });

  final double? distanceM;
  final int? durationS;
  final Sport sport;
  final UnitsPrefs prefs;

  @override
  Widget build(BuildContext context) {
    final parts = <String>[];
    if (durationS != null) {
      parts.add(_formatDuration(durationS!));
    }
    if (distanceM != null && distanceM! > 0) {
      parts.add(formatDistance(distanceM!, prefs, sport));
    }
    if (parts.isEmpty) return const SizedBox.shrink();

    return Text(
      parts.join(' · '),
      style: Theme.of(context)
          .textTheme
          .bodySmall
          ?.copyWith(color: Theme.of(context).colorScheme.secondary),
    );
  }

  static String _formatDuration(int seconds) {
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    if (h > 0) return '${h}h ${m}m';
    return '${m}m';
  }
}
