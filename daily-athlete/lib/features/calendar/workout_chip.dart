// lib/features/calendar/workout_chip.dart
//
// Sport-colored workout pill widget for calendar grid cells.
//
// Planned workouts are a dashed sport-color outline with no fill.
// Completed workouts use the full sport color.
// Colors come from Sport.color (the canonical palette shared with web).

import 'package:flutter/material.dart';

import '../../models/activity_summary.dart';
import '../../models/sport.dart';
import '../shared/dashed_border.dart';

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
    final textColor = isCompleted ? Colors.white : sport.color;

    final chip = Container(
        margin: const EdgeInsets.symmetric(vertical: 1),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: isCompleted ? sport.color : null,
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
                    color: isCompleted ? Colors.white : sport.color,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
    );

    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: isCompleted
          ? chip
          : DashedBorder(color: sport.color, radius: 8, child: chip),
    );
  }
}

// ---------------------------------------------------------------------------
// SportDot — minimal dot badge for month-view cells (up to 3 per day)
// ---------------------------------------------------------------------------

/// A 6 px dot in the sport color (filled when done, a ring when planned). Used in Month view day cells
/// as compact workout badges (up to 3 shown per day, rest truncated).
class SportDot extends StatelessWidget {
  const SportDot({super.key, required this.sport, this.isCompleted = true});

  final Sport sport;
  final bool isCompleted;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 6,
      height: 6,
      margin: const EdgeInsets.symmetric(horizontal: 1),
      decoration: BoxDecoration(
        color: isCompleted ? sport.color : null,
        border: isCompleted ? null : Border.all(color: sport.color),
        shape: BoxShape.circle,
      ),
    );
  }
}
