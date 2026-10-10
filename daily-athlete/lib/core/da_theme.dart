import 'package:flutter/material.dart';

import '../models/sport.dart';

/// Brand tokens that Material's ColorScheme has no slot for.
@immutable
class DaTheme extends ThemeExtension<DaTheme> {
  const DaTheme({
    required this.clay,
    required this.outlineStrong,
    required this.eyebrow,
    required this.metricLarge,
    required this.metric,
  });

  final Color clay;
  final Color outlineStrong;

  /// Mono 11px uppercase kicker, +0.18em tracking.
  final TextStyle eyebrow;

  /// Mono 30/36 w500, -0.03em tracking, tabular figures.
  final TextStyle metricLarge;

  /// Mono 14 w600, tabular figures.
  final TextStyle metric;

  Color sportColor(Sport sport) => sport.color;

  static const _tabular = [FontFeature.tabularFigures()];

  static DaTheme build({required Color clay, required Color outlineStrong}) {
    return DaTheme(
      clay: clay,
      outlineStrong: outlineStrong,
      eyebrow: const TextStyle(
        fontFamily: 'GeistMono',
        fontSize: 11,
        height: 16 / 11,
        fontWeight: FontWeight.w500,
        letterSpacing: 11 * 0.18,
      ),
      metricLarge: const TextStyle(
        fontFamily: 'GeistMono',
        fontSize: 30,
        height: 36 / 30,
        fontWeight: FontWeight.w500,
        letterSpacing: 30 * -0.03,
        fontFeatures: _tabular,
      ),
      metric: const TextStyle(
        fontFamily: 'GeistMono',
        fontSize: 14,
        height: 20 / 14,
        fontWeight: FontWeight.w600,
        fontFeatures: _tabular,
      ),
    );
  }

  @override
  DaTheme copyWith({
    Color? clay,
    Color? outlineStrong,
    TextStyle? eyebrow,
    TextStyle? metricLarge,
    TextStyle? metric,
  }) {
    return DaTheme(
      clay: clay ?? this.clay,
      outlineStrong: outlineStrong ?? this.outlineStrong,
      eyebrow: eyebrow ?? this.eyebrow,
      metricLarge: metricLarge ?? this.metricLarge,
      metric: metric ?? this.metric,
    );
  }

  @override
  DaTheme lerp(ThemeExtension<DaTheme>? other, double t) {
    if (other is! DaTheme) return this;
    return DaTheme(
      clay: Color.lerp(clay, other.clay, t)!,
      outlineStrong: Color.lerp(outlineStrong, other.outlineStrong, t)!,
      eyebrow: TextStyle.lerp(eyebrow, other.eyebrow, t)!,
      metricLarge: TextStyle.lerp(metricLarge, other.metricLarge, t)!,
      metric: TextStyle.lerp(metric, other.metric, t)!,
    );
  }
}

extension DaThemeContext on BuildContext {
  DaTheme get da => Theme.of(this).extension<DaTheme>()!;
}
