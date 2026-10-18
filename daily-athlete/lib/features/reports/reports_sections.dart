import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/da_theme.dart';
import '../../models/athlete_overview.dart';
import '../../models/period_review.dart';
import '../../models/sport.dart';
import '../dashboard/home_format.dart';
import '../shared/eyebrow.dart';
import '../shared/load_bar.dart';
import '../shared/metric_tile.dart';
import '../shared/status_pill.dart';
import 'reports_view.dart';

const _months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/// Pure helpers, exported for tests.

/// Percent change of [load] vs [prev] load; null when there is no baseline.
int? loadChangePct(double load, double? prev) {
  if (prev == null || prev <= 0) return null;
  return ((load - prev) / prev * 100).round();
}

/// For each period in [periods] (newest first), the previous period of the
/// same kind, or null for the oldest.
PeriodReviewSummary? previousOfKind(
  List<PeriodReviewSummary> periods,
  int index,
) {
  for (var i = index + 1; i < periods.length; i++) {
    if (periods[i].kind == periods[index].kind) return periods[i];
  }
  return null;
}

/// One column of the weekly load chart.
class WeeklyLoadBar {
  const WeeklyLoadBar({
    required this.label,
    required this.load,
    required this.isCurrent,
  });

  final String label;
  final double load;
  final bool isCurrent;
}

/// The newest [count] weekly periods, oldest first, so the chart reads left
/// to right. [periods] is newest first; its first weekly entry is the
/// current week.
List<WeeklyLoadBar> weeklyLoadBars(
  List<PeriodReviewSummary> periods, {
  int count = 8,
}) {
  final weeks = periods
      .where((p) => p.kind == PeriodKind.weekly)
      .take(count)
      .toList();
  return [
    for (var i = weeks.length - 1; i >= 0; i--)
      WeeklyLoadBar(
        label: shortDate(weeks[i].bounds.start),
        load: weeks[i].load,
        isCurrent: i == 0,
      ),
  ];
}

/// Mean load of the weeks before the current one; null with no history.
double? priorAverageLoad(List<WeeklyLoadBar> bars) {
  final prior = bars.where((b) => !b.isCurrent).toList();
  if (prior.isEmpty) return null;
  return prior.fold<double>(0, (a, b) => a + b.load) / prior.length;
}

/// How a week-over-week change should read. A jump of more than 30% is the
/// usual overreach warning; anything within 5% is steady.
enum LoadChangeTone { spike, up, steady, down }

LoadChangeTone loadChangeTone(int pct) {
  if (pct > 30) return LoadChangeTone.spike;
  if (pct > 5) return LoadChangeTone.up;
  if (pct >= -5) return LoadChangeTone.steady;
  return LoadChangeTone.down;
}

String shortDate(String ymd) {
  final d = DateTime.parse('${ymd}T00:00:00Z');
  return '${d.day} ${_months[d.month - 1]}';
}

class KpiGrid extends StatelessWidget {
  const KpiGrid({super.key, required this.overview});

  final AthleteOverview overview;

  @override
  Widget build(BuildContext context) {
    final delta = overview.last28DeltaPct;
    final tiles = [
      MetricTile(
        label: 'Fitness (CTL)',
        value: overview.ctl.toStringAsFixed(1),
        sub: 'Long-run load',
      ),
      MetricTile(
        label: 'Fatigue (ATL)',
        value: overview.atl.toStringAsFixed(1),
        sub: 'Recent load',
      ),
      MetricTile(
        label: 'Form (TSB)',
        value: signed1(overview.tsb),
        sub: formVerdict(overview.tsb),
      ),
      MetricTile(
        label: 'Last 28 days',
        value: '${overview.last28Hours.toStringAsFixed(1)} h',
        sub: delta == null
            ? 'No prior 28 days'
            : '${delta >= 0 ? '+' : '−'}${(delta.abs() * 100).round()}% vs prior 28',
      ),
    ];
    return Column(
      children: [
        for (var r = 0; r < 2; r++) ...[
          if (r > 0) const SizedBox(height: 8),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: tiles[r * 2]),
                const SizedBox(width: 8),
                Expanded(child: tiles[r * 2 + 1]),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class GoalEventStrip extends StatelessWidget {
  const GoalEventStrip({super.key, required this.race});

  final RaceInfo race;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: scheme.inverseSurface,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'GOAL EVENT',
                  style: context.da.eyebrow.copyWith(
                    color: scheme.onInverseSurface.withValues(alpha: 0.7),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  race.label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.titleMedium?.copyWith(
                    color: scheme.onInverseSurface,
                  ),
                ),
                Text(
                  fmtDayDate(DateTime.parse(race.date)),
                  style: textTheme.bodySmall?.copyWith(
                    color: scheme.onInverseSurface.withValues(alpha: 0.7),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${race.days}',
                style: context.da.metricLarge.copyWith(
                  color: scheme.onInverseSurface,
                ),
              ),
              Text(
                'days to go',
                style: textTheme.labelMedium?.copyWith(
                  color: scheme.onInverseSurface.withValues(alpha: 0.7),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.title,
    this.note,
    this.trailing,
    required this.child,
  });

  final String title;
  final String? note;
  final Widget? trailing;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(title, style: textTheme.titleMedium)),
                if (trailing != null) trailing!,
              ],
            ),
            if (note != null)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(
                  note!,
                  style: textTheme.bodySmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

/// Training load for each of the last weeks, current week highlighted.
class WeeklyLoadCard extends StatelessWidget {
  const WeeklyLoadCard({super.key, required this.bars});

  final List<WeeklyLoadBar> bars;

  static const _barAreaHeight = 96.0;

  @override
  Widget build(BuildContext context) {
    if (bars.length < 2) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;
    final small = context.da.metricSmall;
    final maxLoad = bars.map((b) => b.load).reduce(math.max);
    final avg = priorAverageLoad(bars);

    return SectionCard(
      title: 'Weekly load',
      note: avg == null
          ? 'This week is highlighted.'
          : 'This week is highlighted. Average of the weeks before: ${avg.round()}.',
      child: SizedBox(
        // The two text labels grow with the user's text size; the bars don't.
        height: _barAreaHeight +
            44 * math.max(1.0, MediaQuery.textScalerOf(context).scale(1)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            for (final bar in bars)
              Expanded(
                child: Semantics(
                  label:
                      'Week of ${bar.label}, load ${bar.load.round()}${bar.isCurrent ? ', this week' : ''}',
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          '${bar.load.round()}',
                          style: small.copyWith(
                            color: bar.isCurrent
                                ? scheme.onSurface
                                : scheme.onSurfaceVariant,
                            fontWeight: bar.isCurrent
                                ? FontWeight.w600
                                : FontWeight.w400,
                          ),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Container(
                        height: maxLoad == 0
                            ? 2
                            : math.max(2, _barAreaHeight * bar.load / maxLoad),
                        margin: const EdgeInsets.symmetric(horizontal: 4),
                        decoration: BoxDecoration(
                          color: bar.isCurrent
                              ? scheme.primary
                              : scheme.outline.withValues(alpha: 0.5),
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(4),
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text(
                          bar.label,
                          style: small.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// "↑ 88%" pill coloured by how big the week-over-week move is.
class LoadChangeChip extends StatelessWidget {
  const LoadChangeChip({super.key, required this.pct});

  final int pct;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (bg, fg) = switch (loadChangeTone(pct)) {
      LoadChangeTone.spike => (scheme.primaryContainer, scheme.onPrimaryContainer),
      LoadChangeTone.up => (scheme.secondaryContainer, scheme.onSecondaryContainer),
      _ => (scheme.surfaceContainer, scheme.onSurfaceVariant),
    };
    final arrow = pct > 0 ? '↑' : (pct < 0 ? '↓' : '→');
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        '$arrow ${pct.abs()}%',
        style: context.da.metricSmall.copyWith(
          color: fg,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _RangeToggle extends StatelessWidget {
  const _RangeToggle({
    required this.labels,
    required this.index,
    required this.onChanged,
  });

  final List<String> labels;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<int>(
      showSelectedIcon: false,
      style: const ButtonStyle(visualDensity: VisualDensity.compact),
      segments: [
        for (var i = 0; i < labels.length; i++)
          ButtonSegment(
            value: i,
            label: FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(labels[i], maxLines: 1),
            ),
          ),
      ],
      selected: {index},
      onSelectionChanged: (s) => onChanged(s.first),
    );
  }
}

class FormChartCard extends StatefulWidget {
  const FormChartCard({super.key, required this.overview});

  final AthleteOverview overview;

  @override
  State<FormChartCard> createState() => _FormChartCardState();
}

class _FormChartCardState extends State<FormChartCard> {
  int _range = 0;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final series = _range == 0
        ? widget.overview.series
        : widget.overview.seriesLong;
    final colors = [scheme.secondary, context.da.clay, scheme.onSurfaceVariant];
    List<FlSpot> spots(double Function(LoadPoint) f) => [
      for (var i = 0; i < series.length; i++)
        FlSpot(i.toDouble(), f(series[i])),
    ];
    final lines = [
      spots((p) => p.ctl),
      spots((p) => p.atl),
      spots((p) => p.tsb),
    ];
    const names = ['Fitness', 'Fatigue', 'Form'];
    final latest = series.isEmpty
        ? const <double>[]
        : [series.last.ctl, series.last.atl, series.last.tsb];

    return SectionCard(
      title: 'Fitness, fatigue & form',
      note: 'Press and drag for daily values. Form above the dashed 0 line means rested.',
      trailing: _RangeToggle(
        labels: const ['28d', '90d'],
        index: _range,
        onChanged: (i) => setState(() => _range = i),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 200,
            child: series.length < 2
                ? const Center(child: Text('Not enough data yet.'))
                : LineChart(
                    LineChartData(
                      gridData: FlGridData(
                        drawVerticalLine: false,
                        getDrawingHorizontalLine: (_) => FlLine(
                          color: scheme.outlineVariant,
                          strokeWidth: 1,
                        ),
                      ),
                      // Form crosses zero: above is rested, below is fatigued.
                      extraLinesData: ExtraLinesData(
                        horizontalLines: [
                          HorizontalLine(
                            y: 0,
                            color: scheme.outline,
                            strokeWidth: 1,
                            dashArray: [4, 4],
                          ),
                        ],
                      ),
                      titlesData: FlTitlesData(
                        topTitles: const AxisTitles(),
                        rightTitles: const AxisTitles(),
                        bottomTitles: AxisTitles(
                          sideTitles: SideTitles(
                            showTitles: true,
                            reservedSize: 24,
                            interval: math.max(1, ((series.length - 1) / 3).roundToDouble()),
                            getTitlesWidget: (v, meta) {
                              final i = v.round();
                              if (i < 0 || i >= series.length || v != i.toDouble()) {
                                return const SizedBox.shrink();
                              }
                              return SideTitleWidget(
                                meta: meta,
                                child: Text(
                                  fmtShortIsoDate(series[i].date),
                                  style: context.da.metricSmall.copyWith(
                                    color: scheme.onSurfaceVariant,
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                        leftTitles: AxisTitles(
                          sideTitles: SideTitles(
                            showTitles: true,
                            reservedSize: 32,
                            getTitlesWidget: (v, meta) => Text(
                              v.round().toString(),
                              style: context.da.metricSmall.copyWith(
                                color: scheme.onSurfaceVariant,
                              ),
                            ),
                          ),
                        ),
                      ),
                      borderData: FlBorderData(show: false),
                      // Press and drag to read the exact values for any day.
                      lineTouchData: LineTouchData(
                        touchTooltipData: LineTouchTooltipData(
                          getTooltipColor: (_) => scheme.inverseSurface,
                          getTooltipItems: (touched) => [
                            for (final t in touched)
                              LineTooltipItem(
                                t == touched.first
                                    ? '${fmtShortIsoDate(series[t.spotIndex].date)}\n'
                                    : '',
                                context.da.metricSmall.copyWith(
                                  color: scheme.onInverseSurface,
                                ),
                                children: [
                                  TextSpan(
                                    text: '${names[t.barIndex]} ${signed1(t.y)}',
                                    style: context.da.metricSmall.copyWith(
                                      color: scheme.onInverseSurface,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                          ],
                        ),
                      ),
                      lineBarsData: [
                        for (var i = 0; i < 3; i++)
                          LineChartBarData(
                            spots: lines[i],
                            isCurved: true,
                            color: colors[i],
                            barWidth: 2,
                            dotData: FlDotData(
                              checkToShowDot: (spot, _) => spot.x == lines[i].last.x,
                              getDotPainter: (spot, percent, bar, index) => FlDotCirclePainter(
                                radius: 3.5,
                                color: colors[i],
                                strokeWidth: 0,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 14,
            children: [
              for (final (i, name) in names.indexed)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(width: 10, height: 3, color: colors[i]),
                    const SizedBox(width: 6),
                    Text(
                      series.isEmpty ? name : '$name ${signed1(latest[i])}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class WeeklyHoursCard extends StatelessWidget {
  const WeeklyHoursCard({super.key, required this.weekly});

  final List<WeeklyBucket> weekly;

  static const _weeks = 6;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final recent = weekly.length > _weeks
        ? weekly.sublist(weekly.length - _weeks)
        : weekly;
    final sportsPresent = <Sport>{
      for (final b in recent)
        for (final k in b.bySport.keys) Sport.fromString(k),
    };
    final maxH = recent.fold<double>(0, (a, b) => b.totalH > a ? b.totalH : a);

    return SectionCard(
      title: 'Weekly hours by sport',
      note: 'Weeks start Monday. This week is still in progress.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 160,
            child: BarChart(
              BarChartData(
                maxY: maxH == 0 ? 1 : maxH * 1.15,
                gridData: FlGridData(
                  drawVerticalLine: false,
                  getDrawingHorizontalLine: (_) =>
                      FlLine(color: scheme.outlineVariant, strokeWidth: 1),
                ),
                borderData: FlBorderData(show: false),
                barTouchData: BarTouchData(enabled: false),
                titlesData: FlTitlesData(
                  topTitles: const AxisTitles(),
                  rightTitles: const AxisTitles(),
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 28,
                      getTitlesWidget: (v, meta) => Text(
                        v.round().toString(),
                        style: context.da.metricSmall.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 24,
                      getTitlesWidget: (v, meta) {
                        final i = v.toInt();
                        if (i < 0 || i >= recent.length)
                          return const SizedBox.shrink();
                        return Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(
                            shortDate(recent[i].weekStart),
                            style: context.da.metricSmall.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ),
                barGroups: [
                  for (var i = 0; i < recent.length; i++)
                    BarChartGroupData(
                      x: i,
                      barRods: [
                        () {
                          var from = 0.0;
                          final items = <BarChartRodStackItem>[];
                          for (final e in recent[i].bySport.entries) {
                            final c = Sport.fromString(e.key).color.withValues(
                              alpha: i == recent.length - 1 ? 0.55 : 1,
                            );
                            items.add(
                              BarChartRodStackItem(from, from + e.value, c),
                            );
                            from += e.value;
                          }
                          return BarChartRodData(
                            toY: from,
                            width: 20,
                            borderRadius: BorderRadius.circular(3),
                            rodStackItems: items,
                          );
                        }(),
                      ],
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
              for (final s in sportsPresent)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: s.color,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(s.displayName, style: textTheme.bodySmall),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class BySportCard extends StatefulWidget {
  const BySportCard({super.key, required this.sports});

  final List<SportRow> sports;

  @override
  State<BySportCard> createState() => _BySportCardState();
}

class _BySportCardState extends State<BySportCard> {
  int _range = 0;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    final rows =
        [
            for (final s in widget.sports)
              (
                sport: Sport.fromString(s.sport),
                sessions: _range == 0 ? s.sessions28 : s.sessionsAll,
                hours: _range == 0 ? s.hours28 : s.hoursAll,
              ),
          ].where((r) => r.sessions > 0).toList()
          ..sort((a, b) => b.hours.compareTo(a.hours));
    final maxH = rows.fold<double>(0, (a, r) => r.hours > a ? r.hours : a);

    return SectionCard(
      title: 'By sport',
      note: 'Sessions under a minute are ignored.',
      trailing: _RangeToggle(
        labels: const ['28d', 'All'],
        index: _range,
        onChanged: (i) => setState(() => _range = i),
      ),
      child: rows.isEmpty
          ? Text(
              'No sessions in this range.',
              style: textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
            )
          : LayoutBuilder(
              builder: (context, constraints) {
                final totalH = rows.fold<double>(0, (a, r) => a + r.hours);
                final donut = _SportDonut(
                  slices: [
                    for (final r in rows)
                      (color: r.sport.color, value: r.hours),
                  ],
                  centerValue: '${totalH.toStringAsFixed(1)} h',
                  centerLabel: 'total',
                );
                final list = _sportList(context, rows, maxH);
                if (constraints.maxWidth >= 420) {
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      donut,
                      const SizedBox(width: 20),
                      Expanded(child: list),
                    ],
                  );
                }
                return Column(
                  children: [
                    Center(child: donut),
                    const SizedBox(height: 16),
                    list,
                  ],
                );
              },
            ),
    );
  }

  Widget _sportList(
    BuildContext context,
    List<({Sport sport, int sessions, double hours})> rows,
    double maxH,
  ) {
    final textTheme = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;
    return Column(
      children: [
        for (final r in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        r.sport.displayName,
                        style: textTheme.bodyMedium,
                      ),
                    ),
                    Text(
                      '${r.sessions}× ',
                      style: textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                    Text(
                      '${r.hours.toStringAsFixed(1)} h',
                      style: context.da.metric,
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                LoadBar(
                  value: maxH == 0 ? 0 : r.hours / maxH,
                  color: r.sport.color,
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _SportDonut extends StatelessWidget {
  const _SportDonut({
    required this.slices,
    required this.centerValue,
    required this.centerLabel,
  });

  final List<({Color color, double value})> slices;
  final String centerValue;
  final String centerLabel;

  static const double _size = 140;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return SizedBox(
      width: _size,
      height: _size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          PieChart(
            PieChartData(
              startDegreeOffset: -90,
              centerSpaceRadius: _size / 2 - 18,
              sectionsSpace: 2,
              sections: [
                for (final s in slices)
                  PieChartSectionData(
                    value: s.value,
                    color: s.color,
                    radius: 16,
                    showTitle: false,
                  ),
              ],
            ),
          ),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(centerValue, style: context.da.metric),
              Text(
                centerLabel,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class ReviewCard extends StatelessWidget {
  const ReviewCard({
    super.key,
    required this.summary,
    required this.previous,
  });

  final PeriodReviewSummary summary;
  final PeriodReviewSummary? previous;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final isMonth = summary.kind == PeriodKind.monthly;
    final change = loadChangePct(summary.load, previous?.load);

    Widget cell(String label, String value) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: textTheme.labelMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value, maxLines: 1, style: context.da.metric),
          ),
        ],
      ),
    );

    return Card(
      color: isMonth ? scheme.surfaceContainer : null,
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () =>
            context.push('/reports/${summary.kind.name}/${summary.periodKey}'),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Eyebrow(isMonth ? 'Month' : 'Week')),
                  StatusPill(
                    summary.hasNarration ? 'Note ready' : 'Not yet written',
                    filled: summary.hasNarration,
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                periodLabel(summary.kind, summary.bounds),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: textTheme.titleMedium,
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  cell('Sessions', '${summary.sessions}'),
                  cell('Time', fmtHm(summary.durationS.round())),
                  cell('Load', '${summary.load.round()}'),
                ],
              ),
              const SizedBox(height: 12),
              if (change != null) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    LoadChangeChip(pct: change),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '${loadChangeTone(change) == LoadChangeTone.spike ? 'big jump in load' : 'load'} vs previous ${isMonth ? 'month' : 'week'}',
                        style: textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
