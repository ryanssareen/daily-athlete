// lib/features/calendar/year_heatmap_view.dart
//
// Year heatmap: GitHub-style contribution graph.
// Layout: 52 week columns × 7 day rows (Mon=0 → Sun=6), oldest to newest.
//
// Data model: pre-aggregated Map<DateTime, int> (date → total duration_s).
// The CustomPainter receives only the pre-aggregated map and tier thresholds
// — no DB objects inside paint().
//
// 5 color tiers: 0 = white (empty), 1–4 = progressively darker brand color.
// Tier boundaries computed as quartiles of the non-zero day values.

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'calendar_providers.dart';

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

class YearHeatmapView extends ConsumerWidget {
  const YearHeatmapView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final heatmapAsync = ref.watch(yearHeatmapProvider);

    return heatmapAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(child: Text('Error loading year data: $err')),
      data: (heatmap) => _YearHeatmapCanvas(heatmap: heatmap),
    );
  }
}

// ---------------------------------------------------------------------------
// _YearHeatmapCanvas — scroll wrapper + sizing
// ---------------------------------------------------------------------------

class _YearHeatmapCanvas extends StatelessWidget {
  const _YearHeatmapCanvas({required this.heatmap});

  final Map<DateTime, int> heatmap;

  static const int _weeksPerYear = 53; // worst case 53-week year
  static const int _daysPerWeek = 7;
  static const double _cellSize = 12;
  static const double _cellGap = 2;
  static const double _monthLabelHeight = 16;

  @override
  Widget build(BuildContext context) {
    final totalWidth =
        _weeksPerYear * (_cellSize + _cellGap) - _cellGap;
    final totalHeight =
        _daysPerWeek * (_cellSize + _cellGap) - _cellGap + _monthLabelHeight;

    final thresholds = _computeThresholds(heatmap);
    final baseColor = Theme.of(context).colorScheme.primary;

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 4),
          CustomPaint(
            size: Size(totalWidth, totalHeight),
            painter: YearHeatmapPainter(
              heatmap: heatmap,
              thresholds: thresholds,
              baseColor: baseColor,
              cellSize: _cellSize,
              cellGap: _cellGap,
              monthLabelHeight: _monthLabelHeight,
            ),
          ),
          const SizedBox(height: 8),
          _Legend(baseColor: baseColor),
        ],
      ),
    );
  }

  /// Compute tier thresholds using quartiles of non-zero day values.
  /// Returns a list of 4 threshold values [t1, t2, t3, t4] where:
  ///   duration_s = 0     → tier 0 (empty)
  ///   0 < d <= t1        → tier 1
  ///   t1 < d <= t2       → tier 2
  ///   t2 < d <= t3       → tier 3
  ///   d > t3             → tier 4
  static List<int> _computeThresholds(Map<DateTime, int> heatmap) {
    final nonZero =
        heatmap.values.where((v) => v > 0).toList()..sort();
    if (nonZero.isEmpty) return [1, 2, 3, 4]; // fallback: 1 s each tier

    int quartile(double fraction) {
      final idx = ((nonZero.length - 1) * fraction).round();
      return nonZero[idx.clamp(0, nonZero.length - 1)];
    }

    final t1 = quartile(0.25);
    final t2 = quartile(0.50);
    final t3 = quartile(0.75);
    final max = nonZero.last;

    // Deduplicate: ensure strictly ascending thresholds.
    return [
      t1,
      math.max(t1 + 1, t2),
      math.max(t2 + 1, t3),
      math.max(t3 + 1, max),
    ];
  }
}

// ---------------------------------------------------------------------------
// YearHeatmapPainter — the CustomPainter (exported for testing)
// ---------------------------------------------------------------------------

class YearHeatmapPainter extends CustomPainter {
  YearHeatmapPainter({
    required this.heatmap,
    required this.thresholds,
    required this.baseColor,
    this.cellSize = 12,
    this.cellGap = 2,
    this.monthLabelHeight = 16,
  })  : assert(thresholds.length == 4,
            'thresholds must have exactly 4 values'),
        _tierColors = _buildTierColors(baseColor);

  final Map<DateTime, int> heatmap;

  /// [t1, t2, t3, t4] — values where tier transitions occur.
  final List<int> thresholds;
  final Color baseColor;
  final double cellSize;
  final double cellGap;
  final double monthLabelHeight;

  final List<Color> _tierColors;

  static List<Color> _buildTierColors(Color base) => [
        Colors.white,
        base.withValues(alpha: 0.25),
        base.withValues(alpha: 0.50),
        base.withValues(alpha: 0.75),
        base,
      ];

  int _tier(int durationS) {
    if (durationS <= 0) return 0;
    if (durationS <= thresholds[0]) return 1;
    if (durationS <= thresholds[1]) return 2;
    if (durationS <= thresholds[2]) return 3;
    return 4;
  }

  @override
  void paint(Canvas canvas, Size size) {
    final cellPaint = Paint()..style = PaintingStyle.fill;
    final outlinePaint = Paint()
      ..style = PaintingStyle.stroke
      ..color = Colors.grey.withValues(alpha: 0.2)
      ..strokeWidth = 0.5;
    final textStyle = const TextStyle(
      fontSize: 9,
      color: Colors.grey,
    );

    // Compute the start date: the Monday of the week 52 weeks ago.
    final today = DateTime.now();
    final todayNorm = DateTime.utc(today.year, today.month, today.day);
    final daysBack = 364; // 52 full weeks
    final rawStart = todayNorm.subtract(Duration(days: daysBack));
    // Align to Monday (weekday 1).
    final startOffset = (rawStart.weekday - 1) % 7;
    final startDate = rawStart.subtract(Duration(days: startOffset));

    String? lastMonthLabel;

    for (int week = 0; week < 53; week++) {
      for (int dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
        final cellDate =
            startDate.add(Duration(days: week * 7 + dayOfWeek));

        // Don't draw cells past today.
        if (cellDate.isAfter(todayNorm)) continue;

        final x = week * (cellSize + cellGap);
        final y = monthLabelHeight + dayOfWeek * (cellSize + cellGap);

        final durationS = heatmap[cellDate] ?? 0;
        final tier = _tier(durationS);

        // Cell fill.
        cellPaint.color = _tierColors[tier];
        final rect = RRect.fromRectAndRadius(
          Rect.fromLTWH(x, y, cellSize, cellSize),
          const Radius.circular(2),
        );
        canvas.drawRRect(rect, cellPaint);
        canvas.drawRRect(rect, outlinePaint);

        // Month label on first cell of a month (top row, dayOfWeek == 0).
        if (dayOfWeek == 0) {
          final monthLabel = _monthAbbr(cellDate.month);
          if (monthLabel != lastMonthLabel && cellDate.day <= 7) {
            lastMonthLabel = monthLabel;
            final tp = TextPainter(
              text: TextSpan(text: monthLabel, style: textStyle),
              textDirection: TextDirection.ltr,
            )..layout();
            tp.paint(canvas, Offset(x, 0));
          }
        }
      }
    }
  }

  static const _months = [
    '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  String _monthAbbr(int month) => _months[month.clamp(1, 12)];

  @override
  bool shouldRepaint(YearHeatmapPainter old) =>
      old.heatmap != heatmap ||
      old.thresholds != thresholds ||
      old.baseColor != baseColor;
}

// ---------------------------------------------------------------------------
// _Legend — color tier legend shown below the heatmap
// ---------------------------------------------------------------------------

class _Legend extends StatelessWidget {
  const _Legend({required this.baseColor});

  final Color baseColor;

  static const _labels = ['None', 'Low', '', '', 'High'];

  @override
  Widget build(BuildContext context) {
    final tierColors = [
      Colors.white,
      baseColor.withValues(alpha: 0.25),
      baseColor.withValues(alpha: 0.50),
      baseColor.withValues(alpha: 0.75),
      baseColor,
    ];

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (i) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: tierColors[i],
                borderRadius: BorderRadius.circular(2),
                border: Border.all(
                  color: Colors.grey.withValues(alpha: 0.3),
                ),
              ),
            ),
            if (_labels[i].isNotEmpty) ...[
              const SizedBox(width: 2),
              Text(
                _labels[i],
                style: const TextStyle(fontSize: 9, color: Colors.grey),
              ),
            ],
            const SizedBox(width: 4),
          ],
        );
      }),
    );
  }
}
