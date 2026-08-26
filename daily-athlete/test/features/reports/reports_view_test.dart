// Mirrors the scenario set in
// apps/web/src/components/period-review/__tests__/review-view.test.ts (and
// this app's own report_view_test.dart for the sibling per-workout report)
// — assertions on pure view logic rather than rendered widgets.
// reports_view.dart has no Flutter dependency, so this needs no widget test
// harness.

import 'package:flutter_test/flutter_test.dart';

import 'package:daily_athlete/features/reports/reports_view.dart';
import 'package:daily_athlete/models/period_review.dart';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

Map<String, dynamic> _factsJson({
  String kind = 'weekly',
  String periodKey = '2026-W33',
  int sessions = 4,
  double durationS = 10800,
  double load = 220,
}) {
  return {
    'kind': kind,
    'periodKey': periodKey,
    'bounds': {'start': '2026-08-10', 'end': '2026-08-16'},
    'totals': {
      'sessions': sessions,
      'durationS': durationS,
      'distanceM': 42000.0,
      'load': load,
      'activeDays': 4,
      'loadConfidence': 'power',
    },
    'compliance': {'prescribed': 5, 'completed': 4, 'unplanned': 0},
    'duration': {'status': 'on_target', 'prescribed': 12000.0, 'actual': durationS, 'deltaPct': -10.0},
    'load': {'status': 'on_target', 'prescribed': 240.0, 'actual': load, 'deltaPct': -8.3},
    'sports': [
      {'sport': 'run', 'sessions': 3, 'durationS': 8000.0, 'distanceM': 30000.0, 'load': 160.0},
    ],
    'comparison': {
      'available': true,
      'previousKey': '2026-W32',
      'sessionsDeltaPct': 10.0,
      'durationDeltaPct': -5.0,
      'loadDeltaPct': 3.0,
      'activeDaysDelta': 1,
    },
  };
}

PeriodReviewResponse _response({
  Map<String, dynamic>? narration,
  bool stale = false,
  bool generatable = true,
  bool? retryable,
  Map<String, dynamic>? facts,
}) {
  return PeriodReviewResponse.fromJson({
    'facts': facts ?? _factsJson(),
    'narration': narration,
    'generatedAt': narration == null ? null : '2026-08-17T00:00:00Z',
    'stale': stale,
    'generatable': generatable,
    'retryable': retryable,
  });
}

PeriodReviewSummary _summary({
  int sessions = 4,
  double durationS = 10800,
  double load = 220,
  bool hasNarration = false,
}) {
  return PeriodReviewSummary.fromJson({
    'kind': 'weekly',
    'periodKey': '2026-W33',
    'bounds': {'start': '2026-08-10', 'end': '2026-08-16'},
    'sessions': sessions,
    'durationS': durationS,
    'load': load,
    'hasNarration': hasNarration,
  });
}

void main() {
  // ---------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------

  group('formatDistance', () {
    test('renders km to one decimal', () {
      expect(formatDistance(5000), '5.0 km');
    });

    test('renders an em dash for null — unknown is not zero', () {
      expect(formatDistance(null), '—');
    });
  });

  group('formatDuration', () {
    test('renders hours and minutes', () {
      expect(formatDuration(3900), '1h 5m');
    });

    test('renders minutes only under an hour', () {
      expect(formatDuration(300), '5m');
    });

    test('renders 0m for non-positive input', () {
      expect(formatDuration(0), '0m');
      expect(formatDuration(-5), '0m');
    });
  });

  group('formatDelta', () {
    test('prefixes a plus sign for positive deltas', () {
      expect(formatDelta(12.4), '+12%');
    });

    test('does not double up a minus sign', () {
      expect(formatDelta(-8.9), '-9%');
    });
  });

  group('periodLabel', () {
    test('weekly label reads "Week of <day> <month> <year>"', () {
      final bounds = PeriodBounds(start: '2026-08-10', end: '2026-08-16');
      expect(periodLabel(PeriodKind.weekly, bounds), 'Week of 10 Aug 2026');
    });

    test('monthly label reads "<Month> <year>"', () {
      final bounds = PeriodBounds(start: '2026-08-01', end: '2026-08-31');
      expect(periodLabel(PeriodKind.monthly, bounds), 'August 2026');
    });
  });

  group('loadHint', () {
    test('is silent when load is measured (power)', () {
      expect(loadHint(LoadConfidence.power), isNull);
    });

    test('flags a duration proxy as partly estimated', () {
      expect(loadHint(LoadConfidence.duration), 'partly estimated');
      expect(loadHint(LoadConfidence.mixed), 'partly estimated');
    });

    test('flags a total absence of load data', () {
      expect(loadHint(LoadConfidence.none), 'no load data');
    });
  });

  // ---------------------------------------------------------------------
  // List screen — loading / loaded / empty states
  // ---------------------------------------------------------------------

  group('periodRowSubtitle', () {
    test('shows sessions, duration and load when the athlete trained', () {
      expect(periodRowSubtitle(_summary(sessions: 4, durationS: 10800, load: 220)),
          '4 sessions · 3h 0m · load 220');
    });

    test('singularises "session" for exactly one', () {
      expect(periodRowSubtitle(_summary(sessions: 1)), startsWith('1 session ·'));
    });

    test('shows a distinct message for an untrained period, not zeroed stats', () {
      expect(periodRowSubtitle(_summary(sessions: 0)), 'No sessions logged');
    });
  });

  group('periodRowStatusLabel', () {
    test('reads "Note ready" once narration exists', () {
      expect(periodRowStatusLabel(_summary(hasNarration: true)), 'Note ready');
    });

    test('reads "Not yet written" before any narration exists', () {
      expect(periodRowStatusLabel(_summary(hasNarration: false)), 'Not yet written');
    });
  });

  group('hasAnyTraining — the list screen\'s empty-state gate', () {
    test('true (loaded, non-empty) when at least one period has sessions', () {
      expect(hasAnyTraining([_summary(sessions: 0), _summary(sessions: 3)]), isTrue);
    });

    test('false (empty state) when every listed period is untrained', () {
      expect(hasAnyTraining([_summary(sessions: 0), _summary(sessions: 0)]), isFalse);
    });

    test('false (empty state) for an empty list', () {
      expect(hasAnyTraining(const []), isFalse);
    });
  });

  // ---------------------------------------------------------------------
  // Detail screen — generate/regenerate state machine
  // ---------------------------------------------------------------------

  group('interpretGenerateResponse — narration absent, first attempt', () {
    test('a 200 with no narration and retryable:true -> retryable', () {
      final res = _response(retryable: true);
      final outcome = interpretGenerateResponse(200, res);
      expect(outcome.phase, GeneratePhase.retryable);
      expect(outcome.narration, isNull);
    });

    test('a 200 with no narration and retryable:false -> failed (no false hope)', () {
      final res = _response(retryable: false);
      final outcome = interpretGenerateResponse(200, res);
      expect(outcome.phase, GeneratePhase.failed);
    });
  });

  group('interpretGenerateResponse — narration produced', () {
    test('adopts the fresh narration and reports phase idle', () {
      final res = _response(narration: {'note': 'Solid week.', 'takeaway': 'Add one more long run.'});
      final outcome = interpretGenerateResponse(200, res);
      expect(outcome.phase, GeneratePhase.idle);
      expect(outcome.narration?.note, 'Solid week.');
      expect(outcome.stale, isFalse);
    });

    test('a regenerated narration can still come back stale (KTD3 edge)', () {
      final res = _response(
        narration: {'note': 'Solid week.', 'takeaway': 'Add one more long run.'},
        stale: true,
      );
      final outcome = interpretGenerateResponse(200, res);
      expect(outcome.stale, isTrue);
    });
  });

  group('interpretGenerateResponse — rate limited and transport failures', () {
    test('429 -> rateLimited regardless of body', () {
      expect(interpretGenerateResponse(429, null).phase, GeneratePhase.rateLimited);
    });

    test('a non-2xx, non-429 status with no usable body -> error', () {
      expect(interpretGenerateResponse(500, null).phase, GeneratePhase.error);
    });

    test('HTTP status is NOT the success signal: a 200 with no body is still error', () {
      expect(interpretGenerateResponse(200, null).phase, GeneratePhase.error);
    });
  });

  group('generateButtonLabel', () {
    test('offers "Generate note" when nothing exists yet', () {
      expect(generateButtonLabel(busy: false, hasNarration: false, stale: false), 'Generate note');
    });

    test('offers "Regenerate note" once the stored note is stale', () {
      expect(generateButtonLabel(busy: false, hasNarration: true, stale: true), 'Regenerate note');
    });

    test('offers "Rewrite note" for a fresh note the athlete wants redone', () {
      expect(generateButtonLabel(busy: false, hasNarration: true, stale: false), 'Rewrite note');
    });

    test('busy always reads "Writing…" regardless of prior state', () {
      expect(generateButtonLabel(busy: true, hasNarration: true, stale: true), 'Writing…');
      expect(generateButtonLabel(busy: true, hasNarration: false, stale: false), 'Writing…');
    });
  });

  group('generatePhaseMessage', () {
    test('idle and generating render no message', () {
      expect(generatePhaseMessage(GeneratePhase.idle), isNull);
      expect(generatePhaseMessage(GeneratePhase.generating), isNull);
    });

    test('every failure phase has a distinct, non-empty message', () {
      final phases = [
        GeneratePhase.retryable,
        GeneratePhase.failed,
        GeneratePhase.rateLimited,
        GeneratePhase.error,
      ];
      final messages = phases.map(generatePhaseMessage).toSet();
      expect(messages.length, phases.length, reason: 'each failure phase must read distinctly');
      for (final m in messages) {
        expect(m, isNotNull);
        expect(m, isNotEmpty);
      }
    });
  });
}
