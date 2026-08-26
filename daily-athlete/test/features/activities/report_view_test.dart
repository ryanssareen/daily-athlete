// Mirrors the scenario set in
// apps/web/app/(athlete)/athlete/workouts/[id]/__tests__/ReportSection.test.tsx
// — same fixtures, same assertions on pure view logic rather than rendered
// widgets (report_view.dart has no Flutter dependency, so this needs no
// widget test harness).

import 'package:flutter_test/flutter_test.dart';

import 'package:daily_athlete/features/activities/report_view.dart';
import 'package:daily_athlete/models/workout_report.dart';

DimensionDelta _dim(DimensionStatus status, {double? prescribed, double? actual, double? deltaPct}) {
  if (status == DimensionStatus.unavailable) return const DimensionDelta.unavailable();
  return DimensionDelta.fromJson({
    'status': switch (status) {
      DimensionStatus.onTarget => 'on_target',
      DimensionStatus.under => 'under',
      DimensionStatus.over => 'over',
      DimensionStatus.unavailable => 'unavailable',
    },
    'prescribed': prescribed,
    'actual': actual,
    'deltaPct': deltaPct,
  });
}

IntensityDimensionDelta _intensity(DimensionStatus status,
    {String kind = 'ftp_pct', double value = 75, double? prescribed, double? actual, double? deltaPct}) {
  if (status == DimensionStatus.unavailable) return const IntensityDimensionDelta.unavailable();
  return IntensityDimensionDelta.fromJson({
    'status': switch (status) {
      DimensionStatus.onTarget => 'on_target',
      DimensionStatus.under => 'under',
      DimensionStatus.over => 'over',
      DimensionStatus.unavailable => 'unavailable',
    },
    'target': {'kind': kind, 'value': value},
    'prescribed': prescribed,
    'actual': actual,
    'deltaPct': deltaPct,
  });
}

ExecutionDelta _matchedDelta({
  DimensionDelta? duration,
  DimensionDelta? load,
  IntensityDimensionDelta? intensity,
  VerdictCode code = VerdictCode.executedAsPrescribed,
  String headline = 'Executed as prescribed',
}) {
  return ExecutionDelta.matched(
    verdict: Verdict(code: code, headline: headline),
    dimensions: ExecutionDeltaDimensions(
      duration: duration ?? _dim(DimensionStatus.onTarget, prescribed: 3600, actual: 3480, deltaPct: -3.3),
      load: load ?? _dim(DimensionStatus.onTarget, prescribed: 55, actual: 58, deltaPct: 5.5),
      intensity: intensity ?? _intensity(DimensionStatus.onTarget, prescribed: 75, actual: 76, deltaPct: 1.3),
    ),
  );
}

ExecutionDelta _unmatchedDelta() => ExecutionDelta.unmatched(
      verdict: const Verdict(code: VerdictCode.unplannedEffort, headline: 'An unplanned effort'),
    );

WorkoutReportResponse _report({
  ExecutionDelta? delta,
  ReportNarration? narration,
  bool stale = false,
  bool generatable = true,
  bool? retryable,
  bool? verdictChanged,
}) {
  return WorkoutReportResponse(
    delta: delta ?? _matchedDelta(),
    narration: narration,
    stale: stale,
    generatable: generatable,
    retryable: retryable,
    verdictChanged: verdictChanged,
  );
}

void main() {
  group('narrativeAffordances — absent (no prior attempt)', () {
    test('offers "Show report" and nothing else', () {
      final aff = narrativeAffordances(_report(), false);
      expect(aff.kind, NarrativeViewKind.absent);
      expect(aff.showNote, isFalse);
      expect(aff.showStaleBadge, isFalse);
      expect(aff.supersededMessage, isNull);
      expect(aff.retryMessage, isNull);
      expect(aff.actionLabel, 'Show report');
    });

    test('pending renders "Generating…" and disables the action', () {
      final aff = narrativeAffordances(_report(), true);
      expect(aff.actionLabel, 'Generating…');
      expect(aff.actionDisabled, isTrue);
    });
  });

  group('narrativeAffordances — present (healthy narration)', () {
    test('shows the note, no stale badge, no action', () {
      final aff = narrativeAffordances(
        _report(narration: const ReportNarration(note: 'Solid session.', takeaway: 'Keep it up.')),
        false,
      );
      expect(aff.kind, NarrativeViewKind.present);
      expect(aff.showNote, isTrue);
      expect(aff.showStaleBadge, isFalse);
      expect(aff.actionLabel, isNull);
    });
  });

  group('narrativeAffordances — stale', () {
    test('shows the note plus a stale badge and Regenerate action', () {
      final aff = narrativeAffordances(
        _report(
          narration: const ReportNarration(note: 'Solid session.', takeaway: 'Keep it up.'),
          stale: true,
        ),
        false,
      );
      expect(aff.kind, NarrativeViewKind.stale);
      expect(aff.showNote, isTrue);
      expect(aff.showStaleBadge, isTrue);
      expect(aff.actionLabel, 'Regenerate report');
    });
  });

  group('narrativeAffordances — superseded (verdict category changed)', () {
    test('suppresses the note and shows the superseded message instead', () {
      final aff = narrativeAffordances(
        _report(
          narration: const ReportNarration(note: 'You came up short.', takeaway: 'Push harder.'),
          stale: true,
          verdictChanged: true,
        ),
        false,
      );
      expect(aff.kind, NarrativeViewKind.superseded);
      expect(aff.showNote, isFalse, reason: 'a contradicting note must never render');
      expect(aff.supersededMessage, supersededMessage);
      expect(aff.actionLabel, 'Regenerate report');
    });
  });

  group('narrativeAffordances — retryable_failed (nothing stored)', () {
    test('retryable: true offers "Try again"', () {
      final aff = narrativeAffordances(_report(retryable: true), false);
      expect(aff.kind, NarrativeViewKind.retryableFailed);
      expect(aff.retryMessage, "We couldn't generate a narrative right now.");
      expect(aff.actionLabel, 'Try again');
    });

    test('retryable: false offers no action', () {
      final aff = narrativeAffordances(_report(retryable: false), false);
      expect(aff.kind, NarrativeViewKind.retryableFailed);
      expect(aff.retryMessage, "We couldn't generate a narrative for this workout.");
      expect(aff.actionLabel, isNull);
    });
  });

  group('narrativeAffordances — present narration whose refresh just failed', () {
    test('keeps the old note on screen and still offers a retry', () {
      final aff = narrativeAffordances(
        _report(
          narration: const ReportNarration(note: 'Solid session.', takeaway: 'Keep it up.'),
          retryable: true,
        ),
        false,
      );
      expect(aff.kind, NarrativeViewKind.present);
      expect(aff.showNote, isTrue, reason: 'a failed attempt must never destroy a displayed note');
      expect(aff.retryMessage, isNotNull);
      expect(aff.actionLabel, 'Try again');
    });
  });

  group('KTD2 guard', () {
    test('startGenerate leaves report untouched, only flips pending', () {
      final initial = ReportViewState(report: _report(), pending: false);
      final started = startGenerate(initial);
      expect(started.report, same(initial.report));
      expect(started.pending, isTrue);
      expect(started.requestError, isNull);
    });

    test('failGenerate keeps the prior report on transport failure', () {
      final initial = ReportViewState(report: _report(), pending: true);
      final failed = failGenerate(initial, 'network down');
      expect(failed.report, same(initial.report));
      expect(failed.pending, isFalse);
      expect(failed.requestError, 'network down');
    });

    test('finishGenerate replaces the report and clears pending/error', () {
      final initial = ReportViewState(report: _report(), pending: true, requestError: 'stale error');
      final next = _report(narration: const ReportNarration(note: 'n', takeaway: 't'));
      final finished = finishGenerate(initial, next);
      expect(finished.report, same(next));
      expect(finished.pending, isFalse);
      expect(finished.requestError, isNull);
    });
  });

  group('visibleDimensionRows', () {
    test('unmatched delta yields no rows', () {
      expect(visibleDimensionRows(_unmatchedDelta()), isEmpty);
    });

    test('matched delta with all dimensions available yields three rows in order', () {
      final rows = visibleDimensionRows(_matchedDelta());
      expect(rows.map((r) => r.key), ['duration', 'load', 'intensity']);
    });

    test('an unavailable dimension is omitted, not rendered as a dash (KTD8)', () {
      final rows = visibleDimensionRows(_matchedDelta(load: const DimensionDelta.unavailable()));
      expect(rows.map((r) => r.key), ['duration', 'intensity']);
    });

    test('duration and load format as clock time / TSS', () {
      final rows = visibleDimensionRows(_matchedDelta());
      final duration = rows.firstWhere((r) => r.key == 'duration');
      expect(duration.actualLabel, formatDurationClock(3480));
      expect(duration.prescribedLabel, formatDurationClock(3600));
      final load = rows.firstWhere((r) => r.key == 'load');
      expect(load.actualLabel, '58 TSS');
      expect(load.prescribedLabel, '55 TSS');
    });
  });

  group('verdictTone', () {
    test('maps each closed VerdictCode to its tone', () {
      expect(verdictTone(VerdictCode.executedAsPrescribed), VerdictTone.positive);
      expect(verdictTone(VerdictCode.underExecuted), VerdictTone.warning);
      expect(verdictTone(VerdictCode.overExecuted), VerdictTone.warning);
      expect(verdictTone(VerdictCode.partialData), VerdictTone.neutral);
      expect(verdictTone(VerdictCode.unplannedEffort), VerdictTone.neutral);
    });
  });

  group('formatDurationClock', () {
    test('under an hour renders m:ss', () {
      expect(formatDurationClock(330), '5:30');
    });

    test('an hour or more renders h:mm:ss', () {
      expect(formatDurationClock(3930), '1:05:30');
    });
  });
}
