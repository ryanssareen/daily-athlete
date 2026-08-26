import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/completed_workout.dart';
import '../../models/planned_workout.dart';
import '../../models/sport.dart';
import '../settings/distance_format.dart';
import '../settings/units_notifier.dart';
import 'dashboard_providers.dart';

/// Athlete-facing dashboard. When [athleteId] is provided, fetches data for
/// that specific athlete (used by coaches via AthleteDetailScreen).
/// When null, resolves the current user's id from auth.
class AthleteDashboard extends ConsumerWidget {
  const AthleteDashboard({super.key, this.athleteId});

  final String? athleteId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // If a specific athlete id is given (coach view), watch that provider.
    // Otherwise, resolve through myDashboardProvider which pulls from auth.
    final dataAsync = athleteId != null
        ? ref.watch(athleteDashboardProvider(athleteId!))
        : ref.watch(myDashboardProvider);

    return Scaffold(
      appBar: AppBar(
        title: Text(athleteId != null ? 'Athlete Dashboard' : 'Dashboard'),
        centerTitle: false,
      ),
      body: dataAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(
          child: _ErrorView(
            error: err.toString(),
            onRetry: () {
              if (athleteId != null) {
                ref.invalidate(athleteDashboardProvider(athleteId!));
              } else {
                ref.invalidate(myDashboardProvider);
              }
            },
          ),
        ),
        data: (data) => RefreshIndicator(
          onRefresh: () async {
            if (athleteId != null) {
              ref.invalidate(athleteDashboardProvider(athleteId!));
              await ref.read(athleteDashboardProvider(athleteId!).future);
            } else {
              ref.invalidate(myDashboardProvider);
              await ref.read(myDashboardProvider.future);
            }
          },
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: [
              _StreakBanner(streakDays: data.streakDays),
              const SizedBox(height: 12),
              _WeeklySummaryCard(stats: data.weeklyStats),
              const SizedBox(height: 12),
              _WeekScheduleCard(
                planned: data.weekPlanned,
                completed: data.weekCompleted,
              ),
              const SizedBox(height: 12),
              if (data.nextWorkout != null)
                _NextWorkoutCard(workout: data.nextWorkout!)
              else
                _NoUpcomingCard(),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Streak banner
// ---------------------------------------------------------------------------

class _StreakBanner extends StatelessWidget {
  const _StreakBanner({required this.streakDays});

  final int streakDays;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (streakDays == 0) return const SizedBox.shrink();

    return Card.filled(
      color: theme.colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            Icon(Icons.local_fire_department,
                color: theme.colorScheme.onPrimaryContainer, size: 28),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                '$streakDays-day streak — keep it up!',
                style: theme.textTheme.titleSmall?.copyWith(
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Weekly summary card
// ---------------------------------------------------------------------------

class _WeeklySummaryCard extends StatelessWidget {
  const _WeeklySummaryCard({required this.stats});

  final WeeklyStats stats;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('This Week', style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            Row(
              children: [
                _StatChip(
                  icon: Icons.timer_outlined,
                  label: 'Hours',
                  value: stats.totalHours.toStringAsFixed(1),
                ),
                const SizedBox(width: 12),
                _StatChip(
                  icon: Icons.event_available_outlined,
                  label: 'Done',
                  value:
                      '${stats.completedCount} / ${stats.plannedCount}',
                ),
              ],
            ),
            if (stats.distanceBySport.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Divider(height: 1),
              const SizedBox(height: 10),
              Text('Distance by sport',
                  style: theme.textTheme.labelMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant)),
              const SizedBox(height: 8),
              ...stats.distanceBySport.entries.map((e) => Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: _DistanceRow(sport: e.key, meters: e.value),
                  )),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatChip extends StatelessWidget {
  const _StatChip(
      {required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(icon, size: 16, color: theme.colorScheme.primary),
                const SizedBox(width: 4),
                Text(label,
                    style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
            const SizedBox(height: 4),
            Text(value, style: theme.textTheme.titleMedium),
          ],
        ),
      ),
    );
  }
}

class _DistanceRow extends ConsumerWidget {
  const _DistanceRow({required this.sport, required this.meters});

  final Sport sport;
  final double meters;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final unit = ref.watch(unitsNotifierProvider).valueOrNull?.distance ?? 'km';
    final display = formatDistanceM(meters, unit);
    return Row(
      children: [
        Text(sport.displayName,
            style: theme.textTheme.bodyMedium),
        const Spacer(),
        Text(display,
            style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600)),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Week schedule card (planned vs completed count as progress bar)
// ---------------------------------------------------------------------------

class _WeekScheduleCard extends StatelessWidget {
  const _WeekScheduleCard(
      {required this.planned, required this.completed});

  final List<PlannedWorkoutRow> planned;
  final List<CompletedWorkoutRow> completed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final pct = planned.isEmpty
        ? 0.0
        : (completed.length / planned.length).clamp(0.0, 1.0);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Week schedule', style: theme.textTheme.titleMedium),
                Text('${completed.length} / ${planned.length}',
                    style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: pct,
                minHeight: 8,
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
              ),
            ),
            if (planned.isEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'No workouts scheduled this week.',
                style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Next workout card
// ---------------------------------------------------------------------------

class _NextWorkoutCard extends StatelessWidget {
  const _NextWorkoutCard({required this.workout});

  final PlannedWorkoutRow workout;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final date = workout.scheduledDate;
    final dateStr =
        '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Next Workout', style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            Row(
              children: [
                _SportIcon(sport: workout.sport),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        workout.sport.displayName,
                        style: theme.textTheme.bodyLarge
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      if (workout.rationale != null) ...[
                        const SizedBox(height: 2),
                        Text(
                          workout.rationale!,
                          style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Chip(label: Text(dateStr)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SportIcon extends StatelessWidget {
  const _SportIcon({required this.sport});

  final Sport sport;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final icon = switch (sport) {
      Sport.swim => Icons.pool,
      Sport.bike => Icons.directions_bike,
      Sport.run => Icons.directions_run,
      Sport.strength => Icons.fitness_center,
      Sport.mobility => Icons.self_improvement,
      Sport.other => Icons.sports,
    };

    return Container(
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        color: theme.colorScheme.secondaryContainer,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Icon(icon, color: theme.colorScheme.onSecondaryContainer),
    );
  }
}

class _NoUpcomingCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Icon(Icons.calendar_today_outlined,
                color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(width: 12),
            Text(
              'No upcoming workouts scheduled.',
              style: theme.textTheme.bodyMedium
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Error view
// ---------------------------------------------------------------------------

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.error, required this.onRetry});

  final String error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.cloud_off_outlined,
              size: 56, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Failed to load dashboard',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(error,
              style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant),
              textAlign: TextAlign.center),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}
