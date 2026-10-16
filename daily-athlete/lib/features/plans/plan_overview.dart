// What a plan actually contains: span, weekly volume, sport mix, next session
// and the story, forecast and week outline from the plan view. Shared by the Plan tab (active plan) and the plan
// detail screen (any plan).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../models/plan.dart';
import '../../models/planned_workout.dart';
import '../activities/activity_row.dart' show sportIcon;
import '../reports/reports_view.dart' show formatDuration;
import '../../models/planned_structure.dart';
import '../../models/plan_view.dart';
import 'plan_forecast_card.dart';
import 'plan_outline.dart';
import 'plan_story_card.dart';
import 'plan_summary.dart';
import 'plans_providers.dart';

class PlanOverview extends ConsumerWidget {
  const PlanOverview({super.key, required this.plan, required this.workouts});

  final PlanRow plan;
  final List<PlannedWorkoutRow> workouts;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    if (workouts.isEmpty) {
      return Text(
        'No workouts are scheduled for this plan yet.',
        style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      );
    }
    final viewAsync = ref.watch(planViewProvider(plan.id));
    void retry() => ref.invalidate(planViewProvider(plan.id));
    final summary = summarizePlan(workouts, DateTime.now());
    final weekNumber = summary.currentWeekIndex == null ? null : summary.currentWeekIndex! + 1;
    final daysToEvent = plan.eventDate?.difference(DateTime.now()).inDays;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        viewAsync.when(
          loading: () => const _SectionLoading(),
          error: (_, _) => _SectionError(message: "Couldn't load the plan story", onRetry: retry),
          data: (view) => Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: PlanStoryCard(story: view.story),
          ),
        ),
        _Headline(
          weekNumber: weekNumber,
          totalWeeks: summary.weeks.length,
          daysToEvent: daysToEvent,
          eventDate: plan.eventDate,
        ),
        const SizedBox(height: 16),
        _ProgressCard(summary: summary),
        if (summary.next != null) ...[
          const SizedBox(height: 16),
          _SectionLabel('Next up'),
          _WorkoutTile(workout: summary.next!, showDate: true),
        ],
        const SizedBox(height: 20),
        _SectionLabel('Forecast'),
        viewAsync.when(
          loading: () => const _SectionLoading(),
          error: (_, _) => PlanForecastCard.failed(onRetry: retry),
          data: (view) => view.sectionErrors.contains(PlanSectionError.forecast)
              ? PlanForecastCard.failed(onRetry: retry)
              : PlanForecastCard(forecast: view.forecast),
        ),
        const SizedBox(height: 20),
        _SectionLabel('Week by week'),
        viewAsync.when(
          loading: () => const _SectionLoading(),
          error: (_, _) => _SectionError(message: "Couldn't load the week-by-week outline", onRetry: retry),
          data: (view) => PlanOutline(
            weeks: view.weeks,
            verdictsUnavailable: view.sectionErrors.contains(PlanSectionError.verdicts),
          ),
        ),
        const SizedBox(height: 20),
        _SectionLabel('Sport mix'),
        _SportMix(summary: summary),
      ],
    );
  }
}

class _SectionLoading extends StatelessWidget {
  const _SectionLoading();

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(child: CircularProgressIndicator()),
      );
}

class _SectionError extends StatelessWidget {
  const _SectionError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Expanded(child: Text(message, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error))),
        TextButton(
          style: TextButton.styleFrom(minimumSize: const Size(44, 44)),
          onPressed: onRetry,
          child: const Text('Retry'),
        ),
      ],
    );
  }
}

class _Headline extends StatelessWidget {
  const _Headline({
    required this.weekNumber,
    required this.totalWeeks,
    required this.daysToEvent,
    required this.eventDate,
  });

  final int? weekNumber;
  final int totalWeeks;
  final int? daysToEvent;
  final DateTime? eventDate;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final progress = weekNumber == null ? '$totalWeeks-week plan' : 'Week $weekNumber of $totalWeeks';
    final countdown = (daysToEvent != null && eventDate != null && daysToEvent! >= 0)
        ? '$daysToEvent days to ${DateFormat.MMMd().format(eventDate!)}'
        : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(progress, style: theme.textTheme.headlineSmall),
        if (countdown != null) Text(countdown, style: theme.textTheme.bodyMedium?.copyWith(color: muted)),
      ],
    );
  }
}

class _ProgressCard extends StatelessWidget {
  const _ProgressCard({required this.summary});

  final PlanSummary summary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hours = summary.totalDurationS > 0 ? formatDuration(summary.totalDurationS) : null;
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${summary.done} of ${summary.total} sessions done', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(value: summary.done / summary.total, minHeight: 6),
            ),
            const SizedBox(height: 8),
            Text(
              [
                if (hours != null) '$hours planned in total',
                if (summary.skipped > 0) '${summary.skipped} skipped',
              ].join(' · '),
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _SportMix extends StatelessWidget {
  const _SportMix({required this.summary});

  final PlanSummary summary;

  @override
  Widget build(BuildContext context) {
    final entries = summary.sportSeconds.entries.where((e) => e.value > 0).toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    if (entries.isEmpty) return const Text('No durations set on these workouts.');
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final e in entries)
          Chip(
            avatar: Icon(sportIcon(e.key), size: 16, color: e.key.color),
            label: Text('${e.key.displayName} · ${formatDuration(e.value)}'),
            visualDensity: VisualDensity.compact,
          ),
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(
          text.toUpperCase(),
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                letterSpacing: 1,
              ),
        ),
      );
}

class _WorkoutTile extends StatelessWidget {
  const _WorkoutTile({required this.workout, required this.showDate});

  final PlannedWorkoutRow workout;
  final bool showDate;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final seconds = readStructureDurationSeconds(workout.structure);
    final status = switch (workout.status) {
      PlannedWorkoutStatus.completed => 'Done',
      PlannedWorkoutStatus.skipped => 'Skipped',
      PlannedWorkoutStatus.moved => 'Moved',
      PlannedWorkoutStatus.planned => null,
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        onTap: () => context.push('/calendar/${workout.id}'),
        leading: Icon(sportIcon(workout.sport), color: workout.sport.color),
        title: Text(workout.sport.displayName),
        subtitle: Text([
          if (showDate) DateFormat('EEE, MMM d').format(workout.scheduledDate),
          if (seconds != null) formatDuration(seconds),
        ].join(' · ')),
        trailing: status == null ? const Icon(Icons.chevron_right) : Text(status, style: theme.textTheme.labelMedium),
      ),
    );
  }
}
