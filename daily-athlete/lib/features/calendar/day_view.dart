// lib/features/calendar/day_view.dart
//
// Day view: scrollable list of workouts for the selected date.
// Displays full planned workout details from structure JSONB,
// or completed workout stats for completed activities.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../models/activity_summary.dart';
import '../../models/planned_structure.dart';
import '../../models/planned_workout.dart';
import '../settings/distance_format.dart';
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
      error: (err, stack) {
        debugPrint(
          'DayView: failed to load calendarWeekDataProvider — $err\n$stack',
        );
        return _DayErrorView(
          error: err,
          onRetry: () => ref.invalidate(calendarWeekDataProvider),
        );
      },
      data: (workouts) => _DayContent(
        date: displayDate,
        workouts: workouts,
        onPrevDay: () => _shiftDay(ref, displayDate, -1),
        onNextDay: () => _shiftDay(ref, displayDate, 1),
      ),
    );
  }

  void _shiftDay(WidgetRef ref, DateTime current, int deltaDays) {
    final next = current.add(Duration(days: deltaDays));
    ref.read(selectedDateProvider.notifier).state =
        DateTime.utc(next.year, next.month, next.day);
  }

  void _ensureWeekCovers(WidgetRef ref, DateTime date) {
    final range = ref.read(calendarWeekRangeProvider);
    if (!date.isBefore(range.start) && !date.isAfter(range.end)) return;
    // Shift week range so the date is within Mon–Sun of its week. Deferred
    // to a post-frame callback: Riverpod forbids modifying provider state
    // synchronously during build, which this is called from.
    final weekday = date.weekday;
    final monday = date.subtract(Duration(days: weekday - 1));
    final start = DateTime.utc(monday.year, monday.month, monday.day);
    final end = start.add(const Duration(days: 6));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(calendarWeekRangeProvider.notifier).state =
          (start: start, end: end);
    });
  }
}

// ---------------------------------------------------------------------------
// Error view
// ---------------------------------------------------------------------------

class _DayErrorView extends StatelessWidget {
  const _DayErrorView({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off_outlined,
                size: 56, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text('Failed to load workouts',
                style: theme.textTheme.titleMedium,
                textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text('$error',
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                textAlign: TextAlign.center),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DayContent extends StatelessWidget {
  const _DayContent({
    required this.date,
    required this.workouts,
    required this.onPrevDay,
    required this.onNextDay,
  });

  final DateTime date;
  final List<ActivitySummary> workouts;
  final VoidCallback onPrevDay;
  final VoidCallback onNextDay;

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
                const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                IconButton(
                  onPressed: onPrevDay,
                  icon: const Icon(Icons.chevron_left),
                  tooltip: 'Previous day',
                ),
                Expanded(
                  child: Text(
                    dateLabel,
                    textAlign: TextAlign.center,
                    style: theme.textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                IconButton(
                  onPressed: onNextDay,
                  icon: const Icon(Icons.chevron_right),
                  tooltip: 'Next day',
                ),
              ],
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
    final distanceUnit = ref.watch(unitsNotifierProvider).valueOrNull?.distance ?? 'km';
    final pw = summary.planned;
    final cw = summary.completed;

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
                _PlannedDetails(workout: pw, distanceUnit: distanceUnit),
              ],
              if (cw != null) ...[
                const SizedBox(height: 8),
                _CompletedDetails(
                    distanceM: cw.distanceM, durationS: cw.durationS, distanceUnit: distanceUnit),
              ],
              if (summary.keyMetric(distanceUnit).isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  summary.keyMetric(distanceUnit),
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
  const _PlannedDetails({required this.workout, required this.distanceUnit});

  final PlannedWorkoutRow workout;
  final String distanceUnit;

  @override
  Widget build(BuildContext context) {
    final structure = workout.structure;
    final items = <String>[];

    if (structure['description'] != null) {
      items.add(structure['description'] as String);
    }
    final durationS = readStructureDurationSeconds(structure);
    if (durationS != null) {
      items.add('Target: ${_formatDuration(durationS.round())}');
    }
    if (structure['distance_m'] != null) {
      final m = (structure['distance_m'] as num).toDouble();
      items.add('Distance: ${formatDistanceM(m, distanceUnit)}');
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
  const _CompletedDetails({this.distanceM, this.durationS, required this.distanceUnit});

  final double? distanceM;
  final int? durationS;
  final String distanceUnit;

  @override
  Widget build(BuildContext context) {
    final parts = <String>[];
    if (durationS != null) {
      parts.add(_formatDuration(durationS!));
    }
    if (distanceM != null && distanceM! > 0) {
      parts.add(formatDistanceM(distanceM!, distanceUnit, decimals: 2));
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
