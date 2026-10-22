import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'hr_series.dart';

const _lineColor = Color(0xFFD97E3A);

/// "Heart rate by minute" card. Hidden when Strava has no HR stream.
class HrSeriesCard extends ConsumerWidget {
  const HrSeriesCard({super.key, required this.workoutId});

  final String workoutId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(hrSeriesProvider(workoutId));
    final theme = Theme.of(context);

    return async.when(
      loading: () => _frame(
        theme,
        const SizedBox(height: 180, child: Center(child: CircularProgressIndicator())),
      ),
      error: (_, _) => _frame(theme, _note(theme, 'Couldn’t load heart rate by minute.')),
      data: (result) {
        switch (result.status) {
          case HrSeriesStatus.unavailable:
            return const SizedBox.shrink();
          case HrSeriesStatus.rateLimited:
            return _frame(
              theme,
              _note(theme, 'Strava is limiting requests right now. Try again in a few minutes.'),
            );
          case HrSeriesStatus.reauthRequired:
            return _frame(theme, _note(theme, 'Reconnect Strava in Settings to see this chart.'));
          case HrSeriesStatus.error:
            return _frame(theme, _note(theme, 'Couldn’t load heart rate by minute.'));
          case HrSeriesStatus.ok:
            return _frame(theme, HrMinuteChart(points: result.points));
        }
      },
    );
  }

  Widget _frame(ThemeData theme, Widget child) => Padding(
        padding: const EdgeInsets.only(top: 16),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Heart rate by minute', style: theme.textTheme.titleSmall),
                const SizedBox(height: 12),
                child,
              ],
            ),
          ),
        ),
      );

  Widget _note(ThemeData theme, String text) => Text(
        text,
        style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      );
}

/// Line chart of average bpm per minute. A missing minute (sensor dropout)
/// breaks the line instead of being drawn as a dive to zero.
class HrMinuteChart extends StatelessWidget {
  const HrMinuteChart({super.key, required this.points});

  final List<HrMinutePoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final labelStyle = theme.textTheme.bodySmall?.copyWith(
      fontSize: 10,
      color: theme.colorScheme.onSurfaceVariant,
    );

    final lastMinute = points.last.minute;
    final lo = points.map((p) => p.avg).reduce((a, b) => a < b ? a : b);
    final hi = points.map((p) => p.max).reduce((a, b) => a > b ? a : b);
    final span = hi - lo;
    final step = span <= 40 ? 10 : (span <= 100 ? 20 : 25);
    final minY = (((lo - 5) / step).floor() * step).toDouble();
    final maxY = (((hi + 5) / step).ceil() * step).toDouble();
    final xStep = lastMinute <= 30 ? 5 : (lastMinute <= 90 ? 15 : 30);

    final spots = <FlSpot>[];
    for (var i = 0; i < points.length; i++) {
      if (i > 0 && points[i].minute - points[i - 1].minute > 1) {
        spots.add(FlSpot.nullSpot);
      }
      spots.add(FlSpot(points[i].minute.toDouble(), points[i].avg.toDouble()));
    }

    return Semantics(
      label: 'Average heart rate for each minute of the workout',
      child: SizedBox(
        height: 200,
        child: LineChart(
          LineChartData(
            minX: 0,
            maxX: lastMinute == 0 ? 1 : lastMinute.toDouble(),
            minY: minY,
            maxY: maxY,
            borderData: FlBorderData(show: false),
            gridData: FlGridData(
              drawVerticalLine: false,
              horizontalInterval: step.toDouble(),
              getDrawingHorizontalLine: (_) => FlLine(
                color: theme.colorScheme.outlineVariant,
                strokeWidth: 0.5,
              ),
            ),
            titlesData: FlTitlesData(
              topTitles: const AxisTitles(),
              rightTitles: const AxisTitles(),
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 32,
                  interval: step.toDouble(),
                  getTitlesWidget: (value, meta) =>
                      Text(value.toInt().toString(), style: labelStyle),
                ),
              ),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 22,
                  interval: xStep.toDouble(),
                  getTitlesWidget: (value, meta) => Text(
                    _minutesLabel(value.toInt()),
                    style: labelStyle,
                  ),
                ),
              ),
            ),
            lineTouchData: LineTouchData(
              touchTooltipData: LineTouchTooltipData(
                getTooltipItems: (touched) => [
                  for (final t in touched)
                    LineTooltipItem(
                      'Min ${t.x.toInt() + 1} · ${t.y.toInt()} bpm',
                      theme.textTheme.bodySmall!.copyWith(color: theme.colorScheme.onInverseSurface),
                    ),
                ],
              ),
            ),
            lineBarsData: [
              LineChartBarData(
                spots: spots,
                isCurved: false,
                color: _lineColor,
                barWidth: 2,
                dotData: const FlDotData(show: false),
                belowBarData: BarAreaData(
                  show: true,
                  color: _lineColor.withValues(alpha: 0.14),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _minutesLabel(int m) {
    if (m < 60) return '${m}m';
    final h = m ~/ 60;
    final r = m % 60;
    return r == 0 ? '${h}h' : '${h}h${r}m';
  }
}
