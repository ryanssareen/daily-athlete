// What a plan actually contains: span, weekly volume, sport mix, next session
// and this week's sessions. Shared by the Plan tab (active plan) and the plan
// detail screen (any plan).

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../models/plan.dart';
import '../../models/planned_workout.dart';
import '../activities/activity_row.dart' show sportIcon;
import '../reports/reports_view.dart' show formatDuration;
import '../../models/planned_structure.dart';
import 'plan_summary.dart';

class PlanOverview extends StatelessWidget {
  const PlanOverview({super.key, required this.plan, required this.workouts});

  final PlanRow plan;
  final List<PlannedWorkoutRow> workouts;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (workouts.isEmpty) {
      return Text(
        'No workouts are scheduled for this plan yet.',
        style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      );
    }
    final summary = summarizePlan(workouts, DateTime.now());
    final weekNumber = summary.currentWeekIndex == null ? null : summary.currentWeekIndex! + 1;
    final daysToEvent = plan.eventDate?.difference(DateTime.now()).inDays;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
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
        _SectionLabel('Weekly volume'),
        _WeeklyBars(summary: summary),
        const SizedBox(height: 20),
        _SectionLabel('Sport mix'),
        _SportMix(summary: summary),
        if (summary.thisWeek.isNotEmpty) ...[
          const SizedBox(height: 20),
          _SectionLabel('This week'),
          for (final w in summary.thisWeek) _WorkoutTile(workout: w, showDate: true),
        ],
        const SizedBox(height: 12),
        _FullSchedule(summary: summary, workouts: workouts),
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

class _WeeklyBars extends StatelessWidget {
  const _WeeklyBars({required this.summary});

  final PlanSummary summary;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final maxS = summary.weeks.fold<double>(0, (m, w) => w.durationS > m ? w.durationS : m);
    return Column(
      children: [
        for (var i = 0; i < summary.weeks.length; i++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(
              children: [
                SizedBox(
                  width: 56,
                  child: Text(
                    DateFormat.MMMd().format(summary.weeks[i].start),
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontWeight: i == summary.currentWeekIndex ? FontWeight.w700 : FontWeight.w400,
                    ),
                  ),
                ),
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: maxS == 0 ? 0 : summary.weeks[i].durationS / maxS,
                      minHeight: 10,
                      color: i == summary.currentWeekIndex
                          ? theme.colorScheme.primary
                          : theme.colorScheme.primary.withValues(alpha: 0.45),
                    ),
                  ),
                ),
                SizedBox(
                  width: 64,
                  child: Text(
                    summary.weeks[i].durationS > 0 ? formatDuration(summary.weeks[i].durationS) : '—',
                    textAlign: TextAlign.end,
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
      ],
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

class _FullSchedule extends StatelessWidget {
  const _FullSchedule({required this.summary, required this.workouts});

  final PlanSummary summary;
  final List<PlannedWorkoutRow> workouts;

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      shape: const Border(),
      title: const Text('Full schedule'),
      children: [
        for (final week in summary.weeks) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: const EdgeInsets.only(top: 8, bottom: 4),
              child: Text('Week of ${DateFormat.MMMd().format(week.start)}',
                  style: Theme.of(context).textTheme.labelLarge),
            ),
          ),
          for (final w in workouts.where((w) =>
              !w.scheduledDate.isBefore(week.start) && w.scheduledDate.isBefore(week.start.add(const Duration(days: 7)))))
            _WorkoutTile(workout: w, showDate: true),
        ],
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
