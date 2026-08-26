// Mirrors packages/shared/src/workout-report.ts (WorkoutReportResponseSchema
// and friends) — the JSON contract for GET/POST /api/workouts/:id/report.
// Hand-authored (no TS/Dart codegen across the boundary, see AGENTS.md), so
// field names and discriminants below must be kept in sync with that file by
// hand if it changes.

/// Closed vocabulary computed server-side; a value outside this set is a
/// contract break, not a new UI state, so [fromString] throws rather than
/// falling back silently.
enum VerdictCode {
  executedAsPrescribed,
  underExecuted,
  overExecuted,
  partialData,
  unplannedEffort;

  static VerdictCode fromString(String value) {
    switch (value) {
      case 'executed_as_prescribed':
        return VerdictCode.executedAsPrescribed;
      case 'under_executed':
        return VerdictCode.underExecuted;
      case 'over_executed':
        return VerdictCode.overExecuted;
      case 'partial_data':
        return VerdictCode.partialData;
      case 'unplanned_effort':
        return VerdictCode.unplannedEffort;
      default:
        throw ArgumentError('Unknown VerdictCode: $value');
    }
  }
}

class Verdict {
  const Verdict({required this.code, required this.headline});

  final VerdictCode code;
  final String headline;

  factory Verdict.fromJson(Map<String, dynamic> json) => Verdict(
        code: VerdictCode.fromString(json['code'] as String),
        headline: json['headline'] as String,
      );
}

enum DimensionStatus { onTarget, under, over, unavailable }

/// `duration` / `load`: a plain scalar comparison (seconds, TSS).
class DimensionDelta {
  const DimensionDelta.unavailable()
      : status = DimensionStatus.unavailable,
        prescribed = null,
        actual = null,
        deltaPct = null;

  const DimensionDelta._({
    required this.status,
    required this.prescribed,
    required this.actual,
    required this.deltaPct,
  });

  final DimensionStatus status;
  final double? prescribed;
  final double? actual;
  final double? deltaPct;

  factory DimensionDelta.fromJson(Map<String, dynamic> json) {
    final status = json['status'] as String;
    if (status == 'unavailable') return const DimensionDelta.unavailable();
    return DimensionDelta._(
      status: _statusFromString(status),
      prescribed: (json['prescribed'] as num).toDouble(),
      actual: (json['actual'] as num).toDouble(),
      deltaPct: (json['deltaPct'] as num).toDouble(),
    );
  }
}

DimensionStatus _statusFromString(String value) {
  switch (value) {
    case 'on_target':
      return DimensionStatus.onTarget;
    case 'under':
      return DimensionStatus.under;
    case 'over':
      return DimensionStatus.over;
    case 'unavailable':
      return DimensionStatus.unavailable;
    default:
      throw ArgumentError('Unknown DimensionStatus: $value');
  }
}

enum IntensityTargetKind { ftpPct, zone, paceSPerKm }

/// The prescribed target itself (kind + value), needed alongside the
/// intensity dimension's numbers so the UI can label what unit they're in —
/// "82" alone is meaningless without knowing %FTP vs zone vs pace.
class IntensityTarget {
  const IntensityTarget({required this.kind, required this.value});

  final IntensityTargetKind kind;
  final double value;

  factory IntensityTarget.fromJson(Map<String, dynamic> json) {
    final kind = json['kind'] as String;
    return IntensityTarget(
      kind: switch (kind) {
        'ftp_pct' => IntensityTargetKind.ftpPct,
        'zone' => IntensityTargetKind.zone,
        'pace_s_per_km' => IntensityTargetKind.paceSPerKm,
        _ => throw ArgumentError('Unknown IntensityTarget.kind: $kind'),
      },
      value: (json['value'] as num).toDouble(),
    );
  }
}

/// Same shape as [DimensionDelta] but the resolvable branches additionally
/// carry [target], since intensity numbers alone are unitless.
class IntensityDimensionDelta {
  const IntensityDimensionDelta.unavailable()
      : status = DimensionStatus.unavailable,
        target = null,
        prescribed = null,
        actual = null,
        deltaPct = null;

  const IntensityDimensionDelta._({
    required this.status,
    required this.target,
    required this.prescribed,
    required this.actual,
    required this.deltaPct,
  });

  final DimensionStatus status;
  final IntensityTarget? target;
  final double? prescribed;
  final double? actual;
  final double? deltaPct;

  factory IntensityDimensionDelta.fromJson(Map<String, dynamic> json) {
    final status = json['status'] as String;
    if (status == 'unavailable') {
      return const IntensityDimensionDelta.unavailable();
    }
    return IntensityDimensionDelta._(
      status: _statusFromString(status),
      target: IntensityTarget.fromJson(json['target'] as Map<String, dynamic>),
      prescribed: (json['prescribed'] as num).toDouble(),
      actual: (json['actual'] as num).toDouble(),
      deltaPct: (json['deltaPct'] as num).toDouble(),
    );
  }
}

class ExecutionDeltaDimensions {
  const ExecutionDeltaDimensions({
    required this.duration,
    required this.load,
    required this.intensity,
  });

  final DimensionDelta duration;
  final DimensionDelta load;
  final IntensityDimensionDelta intensity;

  factory ExecutionDeltaDimensions.fromJson(Map<String, dynamic> json) =>
      ExecutionDeltaDimensions(
        duration: DimensionDelta.fromJson(json['duration'] as Map<String, dynamic>),
        load: DimensionDelta.fromJson(json['load'] as Map<String, dynamic>),
        intensity:
            IntensityDimensionDelta.fromJson(json['intensity'] as Map<String, dynamic>),
      );
}

/// Discriminated on [matched]: an unplanned/unmatched effort still carries a
/// [verdict] (`unplanned_effort`), it just never reaches [dimensions].
class ExecutionDelta {
  const ExecutionDelta.unmatched({required this.verdict})
      : matched = false,
        dimensions = null;

  const ExecutionDelta.matched({
    required this.verdict,
    required ExecutionDeltaDimensions this.dimensions,
  }) : matched = true;

  final bool matched;
  final Verdict verdict;
  final ExecutionDeltaDimensions? dimensions;

  factory ExecutionDelta.fromJson(Map<String, dynamic> json) {
    final verdict = Verdict.fromJson(json['verdict'] as Map<String, dynamic>);
    if (json['matched'] == true) {
      return ExecutionDelta.matched(
        verdict: verdict,
        dimensions:
            ExecutionDeltaDimensions.fromJson(json['dimensions'] as Map<String, dynamic>),
      );
    }
    return ExecutionDelta.unmatched(verdict: verdict);
  }
}

class ReportNarration {
  const ReportNarration({required this.note, required this.takeaway});

  final String note;
  final String takeaway;

  factory ReportNarration.fromJson(Map<String, dynamic> json) => ReportNarration(
        note: json['note'] as String,
        takeaway: json['takeaway'] as String,
      );
}

/// What GET/POST /api/workouts/:id/report returns. See the TS schema's own
/// comments (packages/shared/src/workout-report.ts) for the full semantics of
/// stale/generatable/retryable/verdictChanged — ported verbatim into
/// report_view.dart's narrativeStateFor rather than repeated here.
class WorkoutReportResponse {
  const WorkoutReportResponse({
    required this.delta,
    required this.narration,
    required this.stale,
    required this.generatable,
    this.retryable,
    this.verdictChanged,
  });

  final ExecutionDelta delta;
  final ReportNarration? narration;
  final bool stale;
  final bool generatable;
  final bool? retryable;
  final bool? verdictChanged;

  factory WorkoutReportResponse.fromJson(Map<String, dynamic> json) => WorkoutReportResponse(
        delta: ExecutionDelta.fromJson(json['delta'] as Map<String, dynamic>),
        narration: json['narration'] == null
            ? null
            : ReportNarration.fromJson(json['narration'] as Map<String, dynamic>),
        stale: json['stale'] as bool,
        generatable: json['generatable'] as bool,
        retryable: json['retryable'] as bool?,
        verdictChanged: json['verdictChanged'] as bool?,
      );
}
