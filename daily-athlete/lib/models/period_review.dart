// Mirrors packages/shared/src/period-review.ts — the JSON contract for
// GET /api/reviews and GET/POST /api/reviews/:kind/:periodKey. Hand-authored
// (no TS/Dart codegen across the boundary, see AGENTS.md), so field names and
// discriminants below must be kept in sync with that file by hand if it
// changes.
//
// NOT weekly_reviews / workout_report.dart. This is the weekly/monthly
// TREND review (period_reviews table); workout_report.dart is the
// per-workout debrief. Two different features that happen to share a
// generate/regenerate narration shape.

import 'sport.dart';

// ---------------------------------------------------------------------------
// Period identity
// ---------------------------------------------------------------------------

enum PeriodKind {
  weekly,
  monthly;

  static PeriodKind fromString(String value) {
    switch (value) {
      case 'weekly':
        return PeriodKind.weekly;
      case 'monthly':
        return PeriodKind.monthly;
      default:
        throw ArgumentError('Unknown PeriodKind: $value');
    }
  }
}

class PeriodBounds {
  const PeriodBounds({required this.start, required this.end});

  /// Local calendar dates ("YYYY-MM-DD"); [end] is INCLUSIVE.
  final String start;
  final String end;

  factory PeriodBounds.fromJson(Map<String, dynamic> json) => PeriodBounds(
        start: json['start'] as String,
        end: json['end'] as String,
      );
}

// ---------------------------------------------------------------------------
// Deterministic facts
// ---------------------------------------------------------------------------

enum PeriodMetricStatus { onTarget, under, over, unavailable }

PeriodMetricStatus _metricStatusFromString(String value) {
  switch (value) {
    case 'on_target':
      return PeriodMetricStatus.onTarget;
    case 'under':
      return PeriodMetricStatus.under;
    case 'over':
      return PeriodMetricStatus.over;
    case 'unavailable':
      return PeriodMetricStatus.unavailable;
    default:
      throw ArgumentError('Unknown PeriodMetricStatus: $value');
  }
}

/// A prescribed-vs-actual comparison for one aggregate metric over the
/// period (total duration, total load). Discriminated on [status]: the
/// unavailable branch structurally carries no other fields, same discipline
/// as DimensionDelta in workout_report.dart.
class PeriodMetric {
  const PeriodMetric.unavailable()
      : status = PeriodMetricStatus.unavailable,
        prescribed = null,
        actual = null,
        deltaPct = null;

  const PeriodMetric._({
    required this.status,
    required this.prescribed,
    required this.actual,
    required this.deltaPct,
  });

  final PeriodMetricStatus status;
  final double? prescribed;
  final double? actual;
  final double? deltaPct;

  factory PeriodMetric.fromJson(Map<String, dynamic> json) {
    final status = json['status'] as String;
    if (status == 'unavailable') return const PeriodMetric.unavailable();
    return PeriodMetric._(
      status: _metricStatusFromString(status),
      prescribed: (json['prescribed'] as num).toDouble(),
      actual: (json['actual'] as num).toDouble(),
      deltaPct: (json['deltaPct'] as num).toDouble(),
    );
  }
}

/// Plan compliance over the period. [completed] can exceed [prescribed] (an
/// athlete who added sessions), so this is not a bounded ratio.
class PeriodCompliance {
  const PeriodCompliance({
    required this.prescribed,
    required this.completed,
    required this.unplanned,
  });

  final int prescribed;
  final int completed;
  final int unplanned;

  factory PeriodCompliance.fromJson(Map<String, dynamic> json) => PeriodCompliance(
        prescribed: json['prescribed'] as int,
        completed: json['completed'] as int,
        unplanned: json['unplanned'] as int,
      );
}

/// Per-sport rollup. One entry per sport the athlete actually touched in the
/// period.
class PeriodSportRollup {
  const PeriodSportRollup({
    required this.sport,
    required this.sessions,
    required this.durationS,
    required this.distanceM,
    required this.load,
  });

  final Sport sport;
  final int sessions;
  final double durationS;
  /// Null, not zero: unknown distance is a different claim than zero distance.
  final double? distanceM;
  final double load;

  factory PeriodSportRollup.fromJson(Map<String, dynamic> json) => PeriodSportRollup(
        sport: Sport.fromString(json['sport'] as String),
        sessions: json['sessions'] as int,
        durationS: (json['durationS'] as num).toDouble(),
        distanceM: (json['distanceM'] as num?)?.toDouble(),
        load: (json['load'] as num).toDouble(),
      );
}

enum LoadConfidence { power, duration, mixed, none }

LoadConfidence _loadConfidenceFromString(String value) {
  switch (value) {
    case 'power':
      return LoadConfidence.power;
    case 'duration':
      return LoadConfidence.duration;
    case 'mixed':
      return LoadConfidence.mixed;
    case 'none':
      return LoadConfidence.none;
    default:
      throw ArgumentError('Unknown LoadConfidence: $value');
  }
}

class PeriodTotals {
  const PeriodTotals({
    required this.sessions,
    required this.durationS,
    required this.distanceM,
    required this.load,
    required this.activeDays,
    required this.loadConfidence,
  });

  final int sessions;
  final double durationS;
  final double? distanceM;
  final double load;
  final int activeDays;
  final LoadConfidence loadConfidence;

  factory PeriodTotals.fromJson(Map<String, dynamic> json) => PeriodTotals(
        sessions: json['sessions'] as int,
        durationS: (json['durationS'] as num).toDouble(),
        distanceM: (json['distanceM'] as num?)?.toDouble(),
        load: (json['load'] as num).toDouble(),
        activeDays: json['activeDays'] as int,
        loadConfidence: _loadConfidenceFromString(json['loadConfidence'] as String),
      );
}

/// Period-over-period change. Discriminated on [available] rather than a
/// nullable object with zeroed fields — "no earlier period" and "0% change"
/// are different statements.
class PeriodComparison {
  const PeriodComparison.unavailable()
      : available = false,
        previousKey = null,
        sessionsDeltaPct = null,
        durationDeltaPct = null,
        loadDeltaPct = null,
        activeDaysDelta = null;

  const PeriodComparison._({
    required this.available,
    required this.previousKey,
    required this.sessionsDeltaPct,
    required this.durationDeltaPct,
    required this.loadDeltaPct,
    required this.activeDaysDelta,
  });

  final bool available;
  final String? previousKey;
  final double? sessionsDeltaPct;
  final double? durationDeltaPct;
  final double? loadDeltaPct;
  final int? activeDaysDelta;

  factory PeriodComparison.fromJson(Map<String, dynamic> json) {
    if (json['available'] != true) return const PeriodComparison.unavailable();
    return PeriodComparison._(
      available: true,
      previousKey: json['previousKey'] as String,
      sessionsDeltaPct: (json['sessionsDeltaPct'] as num).toDouble(),
      durationDeltaPct: (json['durationDeltaPct'] as num).toDouble(),
      loadDeltaPct: (json['loadDeltaPct'] as num).toDouble(),
      activeDaysDelta: json['activeDaysDelta'] as int,
    );
  }
}

/// The complete deterministic fact set for one period. Recomputed on every
/// read server-side; never persisted.
class PeriodFacts {
  const PeriodFacts({
    required this.kind,
    required this.periodKey,
    required this.bounds,
    required this.totals,
    required this.compliance,
    required this.duration,
    required this.load,
    required this.sports,
    required this.comparison,
  });

  final PeriodKind kind;
  final String periodKey;
  final PeriodBounds bounds;
  final PeriodTotals totals;
  final PeriodCompliance compliance;
  final PeriodMetric duration;
  final PeriodMetric load;
  final List<PeriodSportRollup> sports;
  final PeriodComparison comparison;

  factory PeriodFacts.fromJson(Map<String, dynamic> json) => PeriodFacts(
        kind: PeriodKind.fromString(json['kind'] as String),
        periodKey: json['periodKey'] as String,
        bounds: PeriodBounds.fromJson(json['bounds'] as Map<String, dynamic>),
        totals: PeriodTotals.fromJson(json['totals'] as Map<String, dynamic>),
        compliance: PeriodCompliance.fromJson(json['compliance'] as Map<String, dynamic>),
        duration: PeriodMetric.fromJson(json['duration'] as Map<String, dynamic>),
        load: PeriodMetric.fromJson(json['load'] as Map<String, dynamic>),
        sports: (json['sports'] as List)
            .map((e) => PeriodSportRollup.fromJson(e as Map<String, dynamic>))
            .toList(),
        comparison: PeriodComparison.fromJson(json['comparison'] as Map<String, dynamic>),
      );
}

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------

class PeriodNarration {
  const PeriodNarration({required this.note, required this.takeaway});

  final String note;
  final String takeaway;

  factory PeriodNarration.fromJson(Map<String, dynamic> json) => PeriodNarration(
        note: json['note'] as String,
        takeaway: json['takeaway'] as String,
      );
}

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

/// What GET/POST /api/reviews/:kind/:periodKey return. See the TS schema's
/// own comments (packages/shared/src/period-review.ts) for the full
/// semantics of stale/generatable/retryable — ported into reports_view.dart's
/// interpretGenerateResponse rather than repeated here.
class PeriodReviewResponse {
  const PeriodReviewResponse({
    required this.facts,
    required this.narration,
    required this.generatedAt,
    required this.stale,
    required this.generatable,
    this.retryable,
  });

  final PeriodFacts facts;
  final PeriodNarration? narration;
  final String? generatedAt;
  final bool stale;
  final bool generatable;
  final bool? retryable;

  factory PeriodReviewResponse.fromJson(Map<String, dynamic> json) => PeriodReviewResponse(
        facts: PeriodFacts.fromJson(json['facts'] as Map<String, dynamic>),
        narration: json['narration'] == null
            ? null
            : PeriodNarration.fromJson(json['narration'] as Map<String, dynamic>),
        generatedAt: json['generatedAt'] as String?,
        stale: json['stale'] as bool,
        generatable: json['generatable'] as bool,
        retryable: json['retryable'] as bool?,
      );

  PeriodReviewResponse copyWith({
    PeriodNarration? narration,
    bool? clearNarration,
    String? generatedAt,
    bool? stale,
  }) =>
      PeriodReviewResponse(
        facts: facts,
        narration: clearNarration == true ? null : (narration ?? this.narration),
        generatedAt: generatedAt ?? this.generatedAt,
        stale: stale ?? this.stale,
        generatable: generatable,
        retryable: retryable,
      );
}

/// One row of the "my reviews" listing — a headline stat and whether prose
/// already exists, so the list can render N periods without N round trips.
class PeriodReviewSummary {
  const PeriodReviewSummary({
    required this.kind,
    required this.periodKey,
    required this.bounds,
    required this.sessions,
    required this.durationS,
    required this.load,
    required this.hasNarration,
  });

  final PeriodKind kind;
  final String periodKey;
  final PeriodBounds bounds;
  final int sessions;
  final double durationS;
  final double load;
  final bool hasNarration;

  factory PeriodReviewSummary.fromJson(Map<String, dynamic> json) => PeriodReviewSummary(
        kind: PeriodKind.fromString(json['kind'] as String),
        periodKey: json['periodKey'] as String,
        bounds: PeriodBounds.fromJson(json['bounds'] as Map<String, dynamic>),
        sessions: json['sessions'] as int,
        durationS: (json['durationS'] as num).toDouble(),
        load: (json['load'] as num).toDouble(),
        hasNarration: json['hasNarration'] as bool,
      );
}
