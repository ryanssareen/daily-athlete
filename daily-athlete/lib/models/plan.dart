/// Mirrors public.plans row. See packages/shared/src/plans.ts.
enum PlanStatus {
  active,
  archived;

  static PlanStatus fromString(String value) {
    return PlanStatus.values.firstWhere(
      (s) => s.name == value,
      orElse: () => PlanStatus.active,
    );
  }
}

enum PlanSource {
  aiGenerated,
  coachAssigned,
  imported;

  static PlanSource fromString(String value) {
    const map = {
      'ai_generated': PlanSource.aiGenerated,
      'coach_assigned': PlanSource.coachAssigned,
      'imported': PlanSource.imported,
    };
    return map[value] ?? PlanSource.aiGenerated;
  }

  String get dbValue {
    switch (this) {
      case PlanSource.aiGenerated:
        return 'ai_generated';
      case PlanSource.coachAssigned:
        return 'coach_assigned';
      case PlanSource.imported:
        return 'imported';
    }
  }
}

class PlanRow {
  const PlanRow({
    required this.id,
    required this.athleteId,
    required this.status,
    required this.source,
    this.eventType,
    this.eventDate,
    this.createdFromReviewId,
    this.createdAt,
    this.archivedAt,
    this.deletedAt,
  });

  final String id;
  final String athleteId;
  final PlanStatus status;
  final PlanSource source;
  final String? eventType;
  final DateTime? eventDate;
  final String? createdFromReviewId;
  final DateTime? createdAt;
  final DateTime? archivedAt;
  final DateTime? deletedAt;

  factory PlanRow.fromJson(Map<String, dynamic> json) {
    return PlanRow(
      id: json['id'] as String,
      athleteId: json['athlete_id'] as String,
      status: PlanStatus.fromString(json['status'] as String),
      source: PlanSource.fromString(json['source'] as String),
      eventType: json['event_type'] as String?,
      eventDate: json['event_date'] == null ? null : DateTime.parse(json['event_date'] as String),
      createdFromReviewId: json['created_from_review_id'] as String?,
      createdAt: json['created_at'] == null ? null : DateTime.parse(json['created_at'] as String),
      archivedAt: json['archived_at'] == null ? null : DateTime.parse(json['archived_at'] as String),
      deletedAt: json['deleted_at'] == null ? null : DateTime.parse(json['deleted_at'] as String),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'athlete_id': athleteId,
        'status': status.name,
        'source': source.dbValue,
        if (eventType != null) 'event_type': eventType,
        if (eventDate != null) 'event_date': eventDate!.toIso8601String().substring(0, 10),
      };
}
