import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../settings/units_notifier.dart';
import 'hr_series.dart';

const _lineColor = Color(0xFFD97E3A);
const _cadenceColor = Color(0xFF4A7FB5);
const _paceColor = Color(0xFF5B9A6E);
const _elevationColor = Color(0xFF8A7A6A);
const _powerColor = Color(0xFFA64CA6);

/// "Heart rate by minute" card (heart rate, cadence and pace for runs).
/// Hidden when Strava has no HR stream.
class HrSeriesCard extends ConsumerWidget {
  const HrSeriesCard({
    super.key,
    required this.workoutId,
    this.isRun = false,
  });

  final String workoutId;
  final bool isRun;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(hrSeriesProvider(workoutId));
    final isMiles = ref.watch(unitsNotifierProvider).valueOrNull?.distance == 'miles';
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
            return _frame(theme, HrMinuteChart(points: result.points, isMiles: isMiles));
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
                Text(
                  isRun ? 'Heart rate, cadence and pace' : 'Heart rate by minute',
                  style: theme.textTheme.titleSmall,
                ),
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

/// Line chart of average bpm per minute. On runs, cadence and pace are
/// overlaid: each is scaled into the heart-rate axis range (the legend shows
/// its real range, tooltips its real value), and pace is inverted so faster
/// plots higher. A missing minute (sensor dropout) breaks the line instead of
/// being drawn as a dive to zero.
class HrMinuteChart extends StatelessWidget {
  const HrMinuteChart({super.key, required this.points, this.isMiles = false});

  final List<HrMinutePoint> points;
  final bool isMiles;

  static String formatPace(double speedMs, bool isMiles) {
    final secPerUnit = ((isMiles ? 1609.344 : 1000.0) / speedMs).round();
    return '${secPerUnit ~/ 60}:${(secPerUnit % 60).toString().padLeft(2, '0')}';
  }

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

    final cadences = [for (final p in points) if (p.cadence != null) p.cadence!.toDouble()];
    final speeds = [for (final p in points) if (p.speed != null) p.speed!];
    final elevations = [for (final p in points) if (p.elevation != null) p.elevation!];
    final powers = [for (final p in points) if (p.power != null) p.power!.toDouble()];

    // Maps value v in [vLo, vHi] into the HR axis, leaving 5% headroom.
    double scale(double v, double vLo, double vHi, {bool invert = false}) {
      final t = vHi == vLo ? 0.5 : (v - vLo) / (vHi - vLo);
      return minY + ((invert ? 1 - t : t) * 0.9 + 0.05) * (maxY - minY);
    }

    List<FlSpot> spotsFor(double? Function(HrMinutePoint) y) {
      final out = <FlSpot>[];
      int? prev;
      for (final p in points) {
        final v = y(p);
        if (v == null) continue;
        if (prev != null && p.minute - prev > 1) out.add(FlSpot.nullSpot);
        out.add(FlSpot(p.minute.toDouble(), v));
        prev = p.minute;
      }
      return out;
    }

    LineChartBarData bar(List<FlSpot> spots, Color color, {bool area = false}) =>
        LineChartBarData(
          spots: spots,
          isCurved: false,
          color: color,
          barWidth: 2,
          dotData: const FlDotData(show: false),
          belowBarData: BarAreaData(
            show: area,
            color: color.withValues(alpha: 0.14),
          ),
        );

    final cLo = cadences.isEmpty ? 0.0 : cadences.reduce((a, b) => a < b ? a : b);
    final cHi = cadences.isEmpty ? 0.0 : cadences.reduce((a, b) => a > b ? a : b);
    final sLo = speeds.isEmpty ? 0.0 : speeds.reduce((a, b) => a < b ? a : b);
    final sHi = speeds.isEmpty ? 0.0 : speeds.reduce((a, b) => a > b ? a : b);

    final eLo = elevations.isEmpty ? 0.0 : elevations.reduce((a, b) => a < b ? a : b);
    final eHi = elevations.isEmpty ? 0.0 : elevations.reduce((a, b) => a > b ? a : b);
    final wLo = powers.isEmpty ? 0.0 : powers.reduce((a, b) => a < b ? a : b);
    final wHi = powers.isEmpty ? 0.0 : powers.reduce((a, b) => a > b ? a : b);

    // bar index -> series kind, so tooltips can show the real value.
    final kinds = <String>['hr'];
    final bars = <LineChartBarData>[
      bar(spotsFor((p) => p.avg.toDouble()), _lineColor, area: true),
    ];
    if (cadences.isNotEmpty) {
      kinds.add('cadence');
      bars.add(bar(
        spotsFor((p) => p.cadence == null ? null : scale(p.cadence!.toDouble(), cLo, cHi)),
        _cadenceColor,
      ));
    }
    if (speeds.isNotEmpty) {
      kinds.add('pace');
      bars.add(bar(
        spotsFor((p) => p.speed == null ? null : scale(p.speed!, sLo, sHi)),
        _paceColor,
      ));
    }
    if (elevations.isNotEmpty) {
      kinds.add('elevation');
      bars.add(bar(
        spotsFor((p) => p.elevation == null ? null : scale(p.elevation!, eLo, eHi)),
        _elevationColor,
      ));
    }
    if (powers.isNotEmpty) {
      kinds.add('power');
      bars.add(bar(
        spotsFor((p) => p.power == null ? null : scale(p.power!.toDouble(), wLo, wHi)),
        _powerColor,
      ));
    }

    final unit = isMiles ? '/mi' : '/km';
    Widget legend(Color c, String text) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(width: 10, height: 3, color: c),
            const SizedBox(width: 6),
            Text(text, style: labelStyle),
          ],
        );

    final multi = kinds.length > 1;

    return Semantics(
      label: multi
          ? 'Heart rate with cadence, pace, elevation or power for each minute of the workout'
          : 'Average heart rate for each minute of the workout',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (multi)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Wrap(
                spacing: 14,
                runSpacing: 4,
                children: [
                  legend(_lineColor, 'Heart rate $lo–$hi bpm'),
                  if (cadences.isNotEmpty)
                    legend(_cadenceColor, 'Cadence ${cLo.round()}–${cHi.round()} spm'),
                  if (speeds.isNotEmpty)
                    legend(
                      _paceColor,
                      'Pace ${formatPace(sHi, isMiles)}–${formatPace(sLo, isMiles)} $unit',
                    ),
                  if (elevations.isNotEmpty)
                    legend(_elevationColor, 'Elevation ${eLo.round()}–${eHi.round()} m'),
                  if (powers.isNotEmpty)
                    legend(_powerColor, 'Power ${wLo.round()}–${wHi.round()} W'),
                ],
              ),
            ),
          SizedBox(
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
                          _tooltip(kinds[t.barIndex], t.x.toInt(), unit),
                          theme.textTheme.bodySmall!
                              .copyWith(color: theme.colorScheme.onInverseSurface),
                        ),
                    ],
                  ),
                ),
                lineBarsData: bars,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _tooltip(String kind, int minute, String unit) {
    final p = points.firstWhere(
      (p) => p.minute == minute,
      orElse: () => points.first,
    );
    switch (kind) {
      case 'cadence':
        return 'Min ${minute + 1} · ${p.cadence} spm';
      case 'pace':
        return 'Min ${minute + 1} · ${formatPace(p.speed ?? 1, isMiles)} $unit';
      case 'elevation':
        return 'Min ${minute + 1} · ${p.elevation?.round()} m';
      case 'power':
        return 'Min ${minute + 1} · ${p.power} W';
      default:
        return 'Min ${minute + 1} · ${p.avg} bpm';
    }
  }

  static String _minutesLabel(int m) {
    if (m < 60) return '${m}m';
    final h = m ~/ 60;
    final r = m % 60;
    return r == 0 ? '${h}h' : '${h}h${r}m';
  }
}
