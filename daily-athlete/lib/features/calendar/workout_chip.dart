// lib/features/calendar/workout_chip.dart
//
// Sport-colored workout pill widget for calendar grid cells.
//
// Planned workouts use a lighter shade (30% opacity) of the sport color.
// Completed workouts use the full sport color.
// Sport color map: run=orange, ride=blue, swim=cyan, strength=purple,
// mobility=green, other=gray.

import 'package:flutter/material.dart';

import '../../models/activity_summary.dart';
import '../../models/sport.dart';

// ---------------------------------------------------------------------------
// Sport color palette
// ---------------------------------------------------------------------------

/// Full-saturation sport color for completed workouts.
Color sportColor(Sport sport) {
  switch (sport) {
    case Sport.run:
      return const Color(0xFFFF8C00); // dark orange
    case Sport.bike:
      return const Color(0xFF1565C0); // blue[800]
    case Sport.swim:
      return const Color(0xFF00ACC1); // cyan[600]
    case Sport.strength:
      return const Color(0xFF7B1FA2); // purple[700]
    case Sport.mobility:
      return const Color(0xFF388E3C); // green[700]
    case Sport.other:
      return const Color(0xFF757575); // grey[600]
  }
}

/// Lighter shade for planned (not yet completed) workouts.
Color plannedSportColor(Sport sport) {
  return sportColor(sport).withValues(alpha: 0.30);
}

// ---------------------------------------------------------------------------
// WorkoutChip widget
// ---------------------------------------------------------------------------

/// A small colored pill indicating a single workout in a calendar cell.
///
/// Set [isCompleted] to true to use the full sport color; false gives the
/// lighter planned shade.
class WorkoutChip extends StatelessWidget {
  const WorkoutChip({
    super.key,
    required this.sport,
    required this.isCompleted,
    this.label,
    this.onTap,
    this.onLongPress,
  });

  /// Construct directly from an [ActivitySummary].
  factory WorkoutChip.fromSummary(
    ActivitySummary summary, {
    Key? key,
    VoidCallback? onTap,
    VoidCallback? onLongPress,
  }) {
    return WorkoutChip(
      key: key,
      sport: summary.sport,
      isCompleted: summary.isCompleted,
      label: summary.title,
      onTap: onTap,
      onLongPress: onLongPress,
    );
  }

  final Sport sport;
  final bool isCompleted;

  /// Optional label text shown inside the chip. If null the chip is icon-only.
  final String? label;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final color =
        isCompleted ? sportColor(sport) : plannedSportColor(sport);
    final textColor = isCompleted ? Colors.white : sportColor(sport);

    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 1),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(8),
        ),
        child: label != null
            ? Text(
                label!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight:
                      isCompleted ? FontWeight.w600 : FontWeight.w400,
                  color: textColor,
                ),
              )
            : SizedBox(
                width: 8,
                height: 8,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: isCompleted ? Colors.white : sportColor(sport),
                    shape: BoxShape.circle,
                  ),
                ),
              ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// SportDot — minimal dot badge for month-view cells (up to 3 per day)
// ---------------------------------------------------------------------------

/// A 6 px filled circle dot in the sport color. Used in Month view day cells
/// as compact workout badges (up to 3 shown per day, rest truncated).
class SportDot extends StatelessWidget {
  const SportDot({super.key, required this.sport, this.isCompleted = true});

  final Sport sport;
  final bool isCompleted;

  @override
  Widget build(BuildContext context) {
    final color =
        isCompleted ? sportColor(sport) : plannedSportColor(sport);
    return Container(
      width: 6,
      height: 6,
      margin: const EdgeInsets.symmetric(horizontal: 1),
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
