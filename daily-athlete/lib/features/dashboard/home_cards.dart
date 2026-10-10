import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/da_theme.dart';
import '../../models/athlete_overview.dart';
import '../../models/completed_workout.dart';
import '../../models/plan.dart';
import '../../models/planned_workout.dart';
import '../../router/routes.dart';
import '../activities/manual_log_sheet.dart';
import '../settings/distance_format.dart';
import '../shared/day_strip.dart';
import '../shared/eyebrow.dart';
import '../shared/sport_tile.dart';
import 'home_format.dart';

class _StatCell extends StatelessWidget {
  const _StatCell({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value, maxLines: 1, style: context.da.metricLarge),
          ),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context)
                .textTheme
                .labelMedium
                ?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class WeekHeroCard extends StatelessWidget {
  const WeekHeroCard({
    super.key,
    required this.completed,
    required this.now,
    required this.streakDays,
    required this.distanceUnit,
  });

  final List<CompletedWorkoutRow> completed;
  final DateTime now;
  final int streakDays;
  final String distanceUnit;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final totalS = completed.fold<int>(0, (a, w) => a + (w.durationS ?? 0));
    final totalM = completed.fold<double>(0, (a, w) => a + (w.distanceM ?? 0));
    final bySport = timeBySport(completed);
    final sportTotal = bySport.fold<int>(0, (a, e) => a + e.value);

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Eyebrow('This week · ${weekRangeLabel(now)}')),
                if (streakDays > 0)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                    decoration: BoxDecoration(
                      color: scheme.primaryContainer,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '$streakDays-day streak',
                      style: textTheme.labelMedium?.copyWith(color: scheme.onPrimaryContainer),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _StatCell(value: '${completed.length}', label: 'sessions'),
                const SizedBox(width: 12),
                _StatCell(value: fmtHm(totalS), label: 'hours : min'),
                const SizedBox(width: 12),
                _StatCell(
                  value: totalM > 0
                      ? (distanceUnit == 'miles'
                          ? (totalM / 1000 * kmToMiles).toStringAsFixed(1)
                          : (totalM / 1000).toStringAsFixed(1))
                      : '0',
                  label: distanceUnit == 'miles' ? 'mi total' : 'km total',
                ),
              ],
            ),
            const SizedBox(height: 12),
            DayStrip(days: buildWeekStrip(completed, now)),
            if (sportTotal > 0) ...[
              const SizedBox(height: 12),
              Text(
                'Time by sport',
                style: textTheme.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: SizedBox(
                  height: 8,
                  child: Row(
                    children: [
                      for (final e in bySport)
                        Expanded(
                          flex: e.value,
                          child: Container(color: e.key.color),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 14,
                runSpacing: 4,
                children: [
                  for (final e in bySport)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(color: e.key.color, shape: BoxShape.circle),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          '${e.key.displayName} ${fmtHm(e.value)}',
                          style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                      ],
                    ),
                ],
              ),
            ],
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => showManualLogSheet(context),
                child: const Text('Log workout'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class PlanCard extends StatelessWidget {
  const PlanCard({
    super.key,
    required this.plan,
    required this.race,
    required this.aheadCount,
    required this.nextWorkout,
    required this.now,
  });

  final PlanRow? plan;
  final RaceInfo? race;
  final int aheadCount;
  final PlannedWorkoutRow? nextWorkout;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final eventDate = plan?.eventDate;
    final days = race?.days ?? (eventDate == null ? null : daysUntilDate(eventDate, now));
    final title = race?.label ?? (plan == null ? 'No active plan' : 'Training plan');
    final subtitle = [
      if (eventDate != null) fmtDayDate(eventDate),
      if (plan != null) '$aheadCount workouts ahead',
    ].join(' · ');

    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Eyebrow(
                    plan?.source == PlanSource.aiGenerated ? 'Plan · AI-generated' : 'Plan',
                  ),
                ),
                TextButton(
                  onPressed: () => context.go(Routes.plans),
                  child: const Text('Open plan →'),
                ),
              ],
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: textTheme.titleMedium,
                      ),
                      if (subtitle.isNotEmpty)
                        Text(
                          subtitle,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                        ),
                    ],
                  ),
                ),
                if (days != null) ...[
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text('$days', style: context.da.metricLarge),
                      Text(
                        'days to go',
                        style: textTheme.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ],
              ],
            ),
            const SizedBox(height: 12),
            if (nextWorkout != null)
              Row(
                children: [
                  SportTile(sport: nextWorkout!.sport),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Next: ${nextWorkout!.sport.displayName} · ${fmtDayDate(nextWorkout!.scheduledDate)}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.bodyMedium,
                    ),
                  ),
                ],
              )
            else
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: scheme.surfaceContainer,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  'Nothing planned for the rest of this week. Your next planned session shows here.',
                  style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class FormCard extends StatelessWidget {
  const FormCard({super.key, required this.overview});

  final AthleteOverview overview;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final spots = [
      for (var i = 0; i < overview.series.length; i++)
        FlSpot(i.toDouble(), overview.series[i].tsb),
    ];

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.go(Routes.reports),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Eyebrow('Form'),
              const SizedBox(height: 8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(signed1(overview.tsb), style: context.da.metricLarge),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      formVerdict(overview.tsb),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ),
                ],
              ),
              if (spots.length > 1) ...[
                const SizedBox(height: 8),
                SizedBox(
                  height: 48,
                  child: LineChart(
                    LineChartData(
                      gridData: const FlGridData(show: false),
                      titlesData: const FlTitlesData(show: false),
                      borderData: FlBorderData(show: false),
                      lineTouchData: const LineTouchData(enabled: false),
                      lineBarsData: [
                        LineChartBarData(
                          spots: spots,
                          isCurved: true,
                          color: scheme.primary,
                          barWidth: 2,
                          dotData: const FlDotData(show: false),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  _StatCell(value: overview.ctl.toStringAsFixed(1), label: 'Fitness'),
                  const SizedBox(width: 12),
                  _StatCell(value: overview.atl.toStringAsFixed(1), label: 'Fatigue'),
                  const SizedBox(width: 12),
                  _StatCell(value: '${overview.last28Hours.toStringAsFixed(1)} h', label: 'Last 28 d'),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class RecentSection extends StatelessWidget {
  const RecentSection({
    super.key,
    required this.workouts,
    required this.now,
    required this.distanceUnit,
  });

  final List<CompletedWorkoutRow> workouts;
  final DateTime now;
  final String distanceUnit;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(child: Eyebrow('Recent')),
            TextButton(
              onPressed: () => context.go(Routes.activities),
              child: const Text('See all →'),
            ),
          ],
        ),
        if (workouts.isEmpty)
          Text(
            'No activities yet.',
            style: textTheme.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
          )
        else
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (var i = 0; i < workouts.length; i++) ...[
                  if (i > 0) Divider(height: 1, color: scheme.outlineVariant),
                  InkWell(
                    onTap: () => context.go('/activities/${workouts[i].id}'),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      child: Row(
                        children: [
                          SportTile(sport: workouts[i].sport),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  workouts[i].sport.displayName,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: textTheme.titleMedium,
                                ),
                                Text(
                                  relativeDayLabel(workouts[i].startedAt, now),
                                  style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(fmtHm(workouts[i].durationS ?? 0), style: context.da.metric),
                              if ((workouts[i].distanceM ?? 0) > 0)
                                Text(
                                  formatDistanceM(workouts[i].distanceM!, distanceUnit),
                                  style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }
}
