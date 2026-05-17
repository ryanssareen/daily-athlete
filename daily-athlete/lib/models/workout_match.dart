/// Mirrors public.workout_matches row.
enum WorkoutMatchMethod {
  autoSameDaySport,
  manualUserLink,
  mergedFromManual;

  static WorkoutMatchMethod fromString(String value) {
    const map = {
      'auto_same_day_sport': WorkoutMatchMethod.autoSameDaySport,
      'manual_user_link': WorkoutMatchMethod.manualUserLink,
      'merged_from_manual': WorkoutMatchMethod.mergedFromManual,
    };
    return map[value] ?? WorkoutMatchMethod.manualUserLink;
  }

  String get dbValue {
    switch (this) {
      case WorkoutMatchMethod.autoSameDaySport:
        return 'auto_same_day_sport';
      case WorkoutMatchMethod.manualUserLink:
        return 'manual_user_link';
      case WorkoutMatchMethod.mergedFromManual:
        return 'merged_from_manual';
    }
  }
}

class WorkoutMatchRow {
  const WorkoutMatchRow({
    required this.id,
    required this.plannedWorkoutId,
    required this.completedWorkoutId,
    required this.confidence,
    required this.method,
    required this.matchedAt,
    this.deletedAt,
  });

  final String id;
  final String plannedWorkoutId;
  final String completedWorkoutId;
  final double confidence;
  final WorkoutMatchMethod method;
  final DateTime matchedAt;
  final DateTime? deletedAt;

  factory WorkoutMatchRow.fromJson(Map<String, dynamic> json) {
    return WorkoutMatchRow(
      id: json['id'] as String,
      plannedWorkoutId: json['planned_workout_id'] as String,
      completedWorkoutId: json['completed_workout_id'] as String,
      confidence: (json['confidence'] as num).toDouble(),
      method: WorkoutMatchMethod.fromString(json['method'] as String),
      matchedAt: DateTime.parse(json['matched_at'] as String),
      deletedAt: json['deleted_at'] == null ? null : DateTime.parse(json['deleted_at'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
        'planned_workout_id': plannedWorkoutId,
        'completed_workout_id': completedWorkoutId,
        'confidence': confidence,
        'method': method.dbValue,
      };
}
