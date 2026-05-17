import 'package:flutter/material.dart';

import '../../models/completed_workout.dart';
import '../../models/sport.dart';

/// Returns the Material icon for a given [Sport].
IconData sportIcon(Sport sport) {
  switch (sport) {
    case Sport.run:
      return Icons.directions_run;
    case Sport.bike:
      return Icons.directions_bike;
    case Sport.swim:
      return Icons.pool;
    case Sport.strength:
      return Icons.fitness_center;
    case Sport.mobility:
      return Icons.self_improvement;
    case Sport.other:
      return Icons.sports;
  }
}

/// Single row in the activities feed (R6).
/// Displays: sport icon, formatted date, activity name/title, key metric,
/// total duration.
class ActivityRow extends StatelessWidget {
  const ActivityRow({
    super.key,
    required this.workout,
    this.onTap,
  });

  final CompletedWorkoutRow workout;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final textTheme = theme.textTheme;
    final colorScheme = theme.colorScheme;

    return ListTile(
      leading: CircleAvatar(
        backgroundColor: colorScheme.primaryContainer,
        child: Icon(
          sportIcon(workout.sport),
          color: colorScheme.onPrimaryContainer,
          size: 20,
        ),
      ),
      title: Text(
        _title(workout),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w500),
      ),
      subtitle: Text(
        _formattedDate(workout.startedAt),
        style: textTheme.bodySmall?.copyWith(
          color: colorScheme.onSurfaceVariant,
        ),
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (_keyMetric(workout).isNotEmpty)
            Text(
              _keyMetric(workout),
              style: textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
            ),
          if (workout.durationS != null)
            Text(
              formatDuration(workout.durationS!),
              style: textTheme.bodySmall?.copyWith(
                color: colorScheme.onSurfaceVariant,
              ),
            ),
        ],
      ),
      onTap: onTap,
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers (package-level for reuse in tests)
  // ---------------------------------------------------------------------------

  static String _title(CompletedWorkoutRow w) {
    final name = w.name;
    if (name != null && name.isNotEmpty) return name;
    return w.sport.displayName;
  }

  /// R6: distance for run/ride/swim; duration for strength/other.
  static String _keyMetric(CompletedWorkoutRow w) {
    if (w.distanceM != null && w.distanceM! > 0) {
      final km = w.distanceM! / 1000;
      return '${km.toStringAsFixed(1)} km';
    }
    if (w.durationS != null) {
      return formatDuration(w.durationS!);
    }
    return '';
  }

  static String _formattedDate(DateTime dt) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final d = DateTime(dt.year, dt.month, dt.day);
    final diff = today.difference(d).inDays;
    if (diff == 0) return 'Today';
    if (diff == 1) return 'Yesterday';
    return '${_monthAbbr(dt.month)} ${dt.day}, ${dt.year}';
  }

  static String _monthAbbr(int month) {
    const abbrs = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return abbrs[month - 1];
  }
}

/// Formats [seconds] as a human-readable duration (e.g. "1h 5m" or "45m").
/// Exported so tests and detail screen can reuse it.
String formatDuration(int seconds) {
  final h = seconds ~/ 3600;
  final m = (seconds % 3600) ~/ 60;
  if (h > 0) return '${h}h ${m}m';
  return '${m}m';
}

/// Key metric string for a workout row.
/// Run/bike/swim with distance → "X.X km".
/// Strength/other (or no distance) → formatted duration.
/// Exported for unit tests.
String keyMetricFor(CompletedWorkoutRow w) {
  if (w.distanceM != null && w.distanceM! > 0) {
    final km = w.distanceM! / 1000;
    return '${km.toStringAsFixed(1)} km';
  }
  if (w.durationS != null) {
    return formatDuration(w.durationS!);
  }
  return '';
}
