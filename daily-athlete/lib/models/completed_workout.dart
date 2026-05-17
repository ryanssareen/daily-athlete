import 'sport.dart';

/// Mirrors public.completed_workouts row. See packages/shared/src/completed-workout.ts.
enum CompletedWorkoutSource {
  strava,
  manual;

  static CompletedWorkoutSource fromString(String value) {
    return CompletedWorkoutSource.values.firstWhere(
      (s) => s.name == value,
      orElse: () => CompletedWorkoutSource.manual,
    );
  }
}

class CompletedWorkoutRow {
  const CompletedWorkoutRow({
    required this.id,
    required this.athleteId,
    required this.source,
    required this.startedAt,
    required this.sport,
    required this.summaryStats,
    this.stravaActivityId,
    this.distanceM,
    this.durationS,
    this.supersededById,
    this.createdAt,
    this.deletedAt,
  });

  final String id;
  final String athleteId;
  final CompletedWorkoutSource source;
  final DateTime startedAt;
  final Sport sport;
  final Map<String, dynamic> summaryStats;
  final int? stravaActivityId;
  final double? distanceM;
  final int? durationS;
  final String? supersededById;
  final DateTime? createdAt;
  final DateTime? deletedAt;

  /// Activity name from Strava summary_stats JSONB, or null for manual entries.
  String? get name => summaryStats['name'] as String?;

  factory CompletedWorkoutRow.fromJson(Map<String, dynamic> json) {
    return CompletedWorkoutRow(
      id: json['id'] as String,
      athleteId: json['athlete_id'] as String,
      source: CompletedWorkoutSource.fromString(json['source'] as String),
      startedAt: DateTime.parse(json['started_at'] as String),
      sport: Sport.fromString(json['sport'] as String),
      summaryStats: (json['summary_stats'] as Map<String, dynamic>?) ?? {},
      stravaActivityId: json['strava_activity_id'] as int?,
      distanceM: (json['distance_m'] as num?)?.toDouble(),
      durationS: json['duration_s'] as int?,
      supersededById: json['superseded_by_id'] as String?,
      createdAt: json['created_at'] == null ? null : DateTime.parse(json['created_at'] as String),
      deletedAt: json['deleted_at'] == null ? null : DateTime.parse(json['deleted_at'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'athlete_id': athleteId,
        'source': source.name,
        'started_at': startedAt.toIso8601String(),
        'sport': sport.name,
        'summary_stats': summaryStats,
        if (stravaActivityId != null) 'strava_activity_id': stravaActivityId,
        if (distanceM != null) 'distance_m': distanceM,
        if (durationS != null) 'duration_s': durationS,
      };
}
