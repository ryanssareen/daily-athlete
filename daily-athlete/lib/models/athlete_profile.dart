/// Mirrors public.athlete_profiles row.
/// athlete_profiles must NOT join supabase_realtime — poll, don't subscribe.
enum BackfillStatus {
  idle,
  pending,
  running,
  done,
  failed;

  static BackfillStatus fromString(String value) {
    return BackfillStatus.values.firstWhere(
      (s) => s.name == value,
      orElse: () => BackfillStatus.idle,
    );
  }
}

class AthleteProfileRow {
  const AthleteProfileRow({
    required this.userId,
    required this.backfillStatus,
    this.backfillStartedAt,
    this.backfillCompletedAt,
    this.errorCode,
  });

  final String userId;
  final BackfillStatus backfillStatus;
  final DateTime? backfillStartedAt;
  final DateTime? backfillCompletedAt;
  final String? errorCode;

  factory AthleteProfileRow.fromJson(Map<String, dynamic> json) {
    return AthleteProfileRow(
      userId: json['user_id'] as String,
      backfillStatus: BackfillStatus.fromString(
        json['backfill_status'] as String? ?? 'idle',
      ),
      backfillStartedAt: json['backfill_started_at'] == null
          ? null
          : DateTime.parse(json['backfill_started_at'] as String),
      backfillCompletedAt: json['backfill_completed_at'] == null
          ? null
          : DateTime.parse(json['backfill_completed_at'] as String),
      errorCode: json['error_code'] as String?,
    );
  }
}
