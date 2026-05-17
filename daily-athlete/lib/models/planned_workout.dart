import 'sport.dart';

/// Mirrors public.planned_workouts row. See packages/shared/src/planned-workout.ts.
enum PlannedWorkoutStatus {
  planned,
  completed,
  skipped,
  moved;

  static PlannedWorkoutStatus fromString(String value) {
    return PlannedWorkoutStatus.values.firstWhere(
      (s) => s.name == value,
      orElse: () => PlannedWorkoutStatus.planned,
    );
  }
}

enum EditedByKind {
  athlete,
  coach,
  ai;

  static EditedByKind? fromStringOrNull(String? value) {
    if (value == null) return null;
    return EditedByKind.values.firstWhere(
      (k) => k.name == value,
      orElse: () => EditedByKind.athlete,
    );
  }
}

class PlannedWorkoutRow {
  const PlannedWorkoutRow({
    required this.id,
    required this.athleteId,
    required this.scheduledDate,
    required this.sport,
    required this.structure,
    required this.status,
    this.planId,
    this.plannedLoad,
    this.rationale,
    this.editedByKind,
    this.editedByUserId,
    this.editedAt,
    this.createdAt,
    this.deletedAt,
  });

  final String id;
  final String athleteId;
  final DateTime scheduledDate;
  final Sport sport;
  final Map<String, dynamic> structure;
  final PlannedWorkoutStatus status;
  final String? planId;
  final double? plannedLoad;
  final String? rationale;
  final EditedByKind? editedByKind;
  final String? editedByUserId;
  final DateTime? editedAt;
  final DateTime? createdAt;
  final DateTime? deletedAt;

  factory PlannedWorkoutRow.fromJson(Map<String, dynamic> json) {
    return PlannedWorkoutRow(
      id: json['id'] as String,
      athleteId: json['athlete_id'] as String,
      scheduledDate: DateTime.parse(json['scheduled_date'] as String),
      sport: Sport.fromString(json['sport'] as String),
      structure: (json['structure'] as Map<String, dynamic>?) ?? {},
      status: PlannedWorkoutStatus.fromString(json['status'] as String? ?? 'planned'),
      planId: json['plan_id'] as String?,
      plannedLoad: (json['planned_load'] as num?)?.toDouble(),
      rationale: json['rationale'] as String?,
      editedByKind: EditedByKind.fromStringOrNull(json['edited_by_kind'] as String?),
      editedByUserId: json['edited_by_user_id'] as String?,
      editedAt: json['edited_at'] == null ? null : DateTime.parse(json['edited_at'] as String),
      createdAt: json['created_at'] == null ? null : DateTime.parse(json['created_at'] as String),
      deletedAt: json['deleted_at'] == null ? null : DateTime.parse(json['deleted_at'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'athlete_id': athleteId,
        'scheduled_date': scheduledDate.toIso8601String().substring(0, 10),
        'sport': sport.name,
        'structure': structure,
        'status': status.name,
        if (planId != null) 'plan_id': planId,
        if (plannedLoad != null) 'planned_load': plannedLoad,
        if (rationale != null) 'rationale': rationale,
        if (editedByKind != null) 'edited_by_kind': editedByKind!.name,
        if (editedByUserId != null) 'edited_by_user_id': editedByUserId,
      };
}
