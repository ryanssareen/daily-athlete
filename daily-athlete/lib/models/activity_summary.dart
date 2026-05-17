import 'completed_workout.dart';
import 'planned_workout.dart';
import 'sport.dart';

/// Display-layer view model combining a planned and/or completed workout for
/// calendar and activity-feed rendering. Not a DB table.
class ActivitySummary {
  const ActivitySummary({
    required this.date,
    required this.sport,
    this.planned,
    this.completed,
  });

  final DateTime date;
  final Sport sport;
  final PlannedWorkoutRow? planned;
  final CompletedWorkoutRow? completed;

  bool get isCompleted => completed != null;
  bool get isPlanned => planned != null && completed == null;

  /// Display title: completed activity name if available, otherwise sport name.
  String get title {
    if (completed?.name != null) return completed!.name!;
    if (planned?.rationale != null) return planned!.rationale!;
    return sport.displayName;
  }

  /// Key metric string for activity rows (distance for cardio, duration for strength).
  String get keyMetric {
    final cw = completed;
    if (cw != null) {
      if (cw.distanceM != null && cw.distanceM! > 0) {
        final km = cw.distanceM! / 1000;
        return '${km.toStringAsFixed(1)} km';
      }
      if (cw.durationS != null) {
        return _formatDuration(cw.durationS!);
      }
    }
    return '';
  }

  static String _formatDuration(int seconds) {
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    if (h > 0) return '${h}h ${m}m';
    return '${m}m';
  }
}
