import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/units.dart';
import '../../models/completed_workout.dart';
import '../../models/sport.dart';
import '../settings/units_notifier.dart';

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
class ActivityRow extends ConsumerWidget {
  const ActivityRow({
    super.key,
    required this.workout,
    this.onTap,
  });

  final CompletedWorkoutRow workout;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final textTheme = theme.textTheme;
    final colorScheme = theme.colorScheme;
    final prefs =
        ref.watch(unitsNotifierProvider).valueOrNull ?? const UnitsPrefs();
    final metric = keyMetricFor(workout, prefs);

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
          if (metric.isNotEmpty)
            Text(
              metric,
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
String keyMetricFor(CompletedWorkoutRow w,
    [UnitsPrefs prefs = const UnitsPrefs()]) {
  if (w.distanceM != null && w.distanceM! > 0) {
    return formatDistance(w.distanceM!, prefs, w.sport);
  }
  if (w.durationS != null) {
    return formatDuration(w.durationS!);
  }
  return '';
}
