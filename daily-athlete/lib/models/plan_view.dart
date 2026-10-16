// Mirrors packages/shared/src/plan-view.ts (PlanViewSchema) — the JSON
// contract for GET /api/plans/:id/view. Hand-authored (no TS/Dart codegen
// across the boundary, see AGENTS.md); keep in sync by hand. Parsed against
// packages/shared/test-fixtures/plan-view-sample.json in the model test.

import 'workout_report.dart' show Verdict;

enum PlanPhase {
  build,
  recovery,
  peak,
  taper;

  static PlanPhase fromString(String value) {
    for (final phase in PlanPhase.values) {
      if (phase.name == value) return phase;
    }
    throw FormatException('Unknown PlanPhase: $value');
  }
}

enum PlanSessionStatus {
  planned,
  moved,
  completed;

  static PlanSessionStatus fromString(String value) {
    for (final status in PlanSessionStatus.values) {
      if (status.name == value) return status;
    }
    throw FormatException('Unknown session status: $value');
  }
}

enum PlanSectionError {
  verdicts,
  forecast;

  static PlanSectionError fromString(String value) {
    for (final section in PlanSectionError.values) {
      if (section.name == value) return section;
    }
    throw FormatException('Unknown section error: $value');
  }
}

DateTime _dateOnly(Object? value) {
  final text = value as String;
  if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text)) {
    throw FormatException('Bad date: $text');
  }
  return DateTime.parse(text);
}

double? _optionalDouble(Object? value) => value == null ? null : (value as num).toDouble();

Verdict _verdict(Map<String, dynamic> json) {
  try {
    return Verdict.fromJson(json);
  } on ArgumentError catch (e) {
    throw FormatException(e.message.toString());
  }
}

class PlanStory {
  const PlanStory({required this.paragraphs, required this.whyQuote});

  final List<String> paragraphs;
  final String? whyQuote;

  factory PlanStory.fromJson(Map<String, dynamic> json) => PlanStory(
        paragraphs: (json['paragraphs'] as List).map((e) => e as String).toList(),
        whyQuote: json['whyQuote'] as String?,
      );
}

class PlanViewSession {
  const PlanViewSession({
    required this.id,
    required this.date,
    required this.sport,
    required this.plannedSeconds,
    required this.plannedLoad,
    required this.intensity,
    required this.rationale,
    required this.status,
    required this.verdict,
  });

  final String id;
  final DateTime date;
  final String sport;
  final double? plannedSeconds;
  final double? plannedLoad;
  final String? intensity;
  final String? rationale;
  final PlanSessionStatus status;
  final Verdict? verdict;

  factory PlanViewSession.fromJson(Map<String, dynamic> json) {
    final verdict = json['verdict'];
    return PlanViewSession(
      id: json['id'] as String,
      date: _dateOnly(json['date']),
      sport: json['sport'] as String,
      plannedSeconds: _optionalDouble(json['plannedSeconds']),
      plannedLoad: _optionalDouble(json['plannedLoad']),
      intensity: json['intensity'] as String?,
      rationale: json['rationale'] as String?,
      status: PlanSessionStatus.fromString(json['status'] as String),
      verdict: verdict == null ? null : _verdict(verdict as Map<String, dynamic>),
    );
  }
}

class PlanViewWeek {
  const PlanViewWeek({
    required this.start,
    required this.phase,
    required this.focus,
    required this.plannedSeconds,
    required this.executedSeconds,
    required this.dueSeconds,
    required this.compliance,
    required this.skippedCount,
    required this.current,
    required this.sessions,
  });

  final DateTime start;
  final PlanPhase? phase;
  final String focus;
  final double plannedSeconds;
  final double executedSeconds;
  final double dueSeconds;
  final double? compliance;
  final int skippedCount;
  final bool current;
  final List<PlanViewSession> sessions;

  factory PlanViewWeek.fromJson(Map<String, dynamic> json) {
    final phase = json['phase'];
    return PlanViewWeek(
      start: _dateOnly(json['start']),
      phase: phase == null ? null : PlanPhase.fromString(phase as String),
      focus: json['focus'] as String,
      plannedSeconds: (json['plannedSeconds'] as num).toDouble(),
      executedSeconds: (json['executedSeconds'] as num).toDouble(),
      dueSeconds: (json['dueSeconds'] as num).toDouble(),
      compliance: _optionalDouble(json['compliance']),
      skippedCount: json['skippedCount'] as int,
      current: json['current'] as bool,
      sessions: (json['sessions'] as List)
          .map((e) => PlanViewSession.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}

class ForecastEventDay {
  const ForecastEventDay({required this.date, required this.tsb, required this.formVerdict});

  final DateTime date;
  final double tsb;
  final String formVerdict;

  factory ForecastEventDay.fromJson(Map<String, dynamic> json) => ForecastEventDay(
        date: _dateOnly(json['date']),
        tsb: (json['tsb'] as num).toDouble(),
        formVerdict: json['formVerdict'] as String,
      );
}

sealed class PlanForecast {
  const PlanForecast();

  factory PlanForecast.fromJson(Map<String, dynamic> json) {
    final status = json['status'] as String;
    switch (status) {
      case 'ok':
        final eventDay = json['eventDay'];
        return ForecastOk(
          endOfBlockDate: _dateOnly(json['endOfBlockDate']),
          ctl: (json['ctl'] as num).toDouble(),
          atl: (json['atl'] as num).toDouble(),
          tsb: (json['tsb'] as num).toDouble(),
          formVerdict: json['formVerdict'] as String,
          eventDay: eventDay == null ? null : ForecastEventDay.fromJson(eventDay as Map<String, dynamic>),
        );
      case 'unavailable-no-data':
        return const ForecastUnavailableNoData();
      case 'unavailable-complete':
        return const ForecastUnavailableComplete();
      default:
        throw FormatException('Unknown forecast status: $status');
    }
  }
}

class ForecastOk extends PlanForecast {
  const ForecastOk({
    required this.endOfBlockDate,
    required this.ctl,
    required this.atl,
    required this.tsb,
    required this.formVerdict,
    required this.eventDay,
  });

  final DateTime endOfBlockDate;
  final double ctl;
  final double atl;
  final double tsb;
  final String formVerdict;
  final ForecastEventDay? eventDay;
}

class ForecastUnavailableNoData extends PlanForecast {
  const ForecastUnavailableNoData();
}

class ForecastUnavailableComplete extends PlanForecast {
  const ForecastUnavailableComplete();
}

class PlanView {
  const PlanView({
    required this.planId,
    required this.story,
    required this.weeks,
    required this.forecast,
    required this.sectionErrors,
  });

  final String planId;
  final PlanStory story;
  final List<PlanViewWeek> weeks;
  final PlanForecast forecast;
  final Set<PlanSectionError> sectionErrors;

  factory PlanView.fromJson(Map<String, dynamic> json) {
    try {
      return PlanView(
        planId: json['planId'] as String,
        story: PlanStory.fromJson(json['story'] as Map<String, dynamic>),
        weeks: (json['weeks'] as List)
            .map((e) => PlanViewWeek.fromJson(e as Map<String, dynamic>))
            .toList(),
        forecast: PlanForecast.fromJson(json['forecast'] as Map<String, dynamic>),
        sectionErrors: (json['sectionErrors'] as List)
            .map((e) => PlanSectionError.fromString(e as String))
            .toSet(),
      );
    } on FormatException {
      rethrow;
    } on TypeError catch (e) {
      throw FormatException('Malformed plan view: $e');
    }
  }
}
