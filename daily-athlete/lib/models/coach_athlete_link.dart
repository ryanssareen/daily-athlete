/// Mirrors public.coach_athlete_links row (migration 0010).
enum LinkStatus {
  active,
  archived;

  static LinkStatus fromString(String value) {
    return LinkStatus.values.firstWhere(
      (s) => s.name == value,
      orElse: () => LinkStatus.archived,
    );
  }
}

class CoachAthleteLinkRow {
  const CoachAthleteLinkRow({
    required this.id,
    required this.coachUserId,
    required this.athleteUserId,
    required this.status,
    required this.invitedAt,
    this.acceptedAt,
    this.deletedAt,
  });

  final String id;
  final String coachUserId;
  final String athleteUserId;
  final LinkStatus status;
  final DateTime invitedAt;
  final DateTime? acceptedAt;
  final DateTime? deletedAt;

  bool get isActive => status == LinkStatus.active && deletedAt == null;

  factory CoachAthleteLinkRow.fromJson(Map<String, dynamic> json) {
    return CoachAthleteLinkRow(
      id: json['id'] as String,
      coachUserId: json['coach_user_id'] as String,
      athleteUserId: json['athlete_user_id'] as String,
      status: LinkStatus.fromString(json['status'] as String),
      invitedAt: DateTime.parse(json['invited_at'] as String),
      acceptedAt: json['accepted_at'] == null
          ? null
          : DateTime.parse(json['accepted_at'] as String),
      deletedAt: json['deleted_at'] == null
          ? null
          : DateTime.parse(json['deleted_at'] as String),
    );
  }
}
