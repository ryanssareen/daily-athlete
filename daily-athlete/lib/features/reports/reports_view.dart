// Pure view logic for the Reports feature (mobile mirror of
// apps/web/src/components/period-review/review-view.ts and the two
// apps/web/app/(athlete)/athlete/reports pages). Kept free of Flutter
// widgets so it's unit-testable the same way report_view.dart is, and so
// this file and the widget files can't drift into two different state
// machines.

import '../../models/period_review.dart';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/// An em dash, not "0.0 km", when nothing recorded a distance — "you covered
/// no ground" and "nobody measured" are different claims.
String formatDistance(double? metres) {
  if (metres == null || !metres.isFinite) return '—';
  return '${(metres / 1000).toStringAsFixed(1)} km';
}

String formatDuration(double seconds) {
  if (!seconds.isFinite || seconds <= 0) return '0m';
  final h = seconds ~/ 3600;
  final m = ((seconds % 3600) / 60).round();
  return h > 0 ? '${h}h ${m}m' : '${m}m';
}

String formatDelta(double pct) {
  final rounded = pct.round();
  return '${rounded > 0 ? '+' : ''}$rounded%';
}

/// Human label for a period, e.g. "Week of 10 Aug 2026" / "August 2026".
String periodLabel(PeriodKind kind, PeriodBounds bounds) {
  final start = DateTime.parse('${bounds.start}T00:00:00Z');
  if (kind == PeriodKind.monthly) {
    return '${_monthName(start.month)} ${start.year}';
  }
  return 'Week of ${start.day} ${_monthAbbrev(start.month)} ${start.year}';
}

const _monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const _monthAbbrevs = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

String _monthName(int month) => _monthNames[month - 1];
String _monthAbbrev(int month) => _monthAbbrevs[month - 1];

/// The hint shown under the load stat. Silent when the figure is measured;
/// explicit whenever any part of it is a duration proxy, because a proxy
/// presented bare reads as a measurement.
String? loadHint(LoadConfidence confidence) {
  switch (confidence) {
    case LoadConfidence.power:
      return null;
    case LoadConfidence.none:
      return 'no load data';
    case LoadConfidence.duration:
    case LoadConfidence.mixed:
      return 'partly estimated';
  }
}

// ---------------------------------------------------------------------------
// List screen — row status
// ---------------------------------------------------------------------------

/// Subtitle for one list row. Mirrors ReportsPage's row text exactly: "no
/// sessions" is a distinct message, not "0 sessions · 0m · load 0".
String periodRowSubtitle(PeriodReviewSummary summary) {
  if (summary.sessions == 0) return 'No sessions logged';
  final sessionWord = summary.sessions == 1 ? 'session' : 'sessions';
  return '${summary.sessions} $sessionWord · ${formatDuration(summary.durationS)} · load ${summary.load.round()}';
}

/// Trailing status label for one list row.
String periodRowStatusLabel(PeriodReviewSummary summary) =>
    summary.hasNarration ? 'Note ready' : 'Not yet written';

/// The list screen's empty state fires when nobody has trained in any listed
/// period — mirrors ReportsPage's `hasAnyTraining` check.
bool hasAnyTraining(List<PeriodReviewSummary> periods) =>
    periods.any((p) => p.sessions > 0);

// ---------------------------------------------------------------------------
// Detail screen — generate/regenerate interaction state
// ---------------------------------------------------------------------------

enum GeneratePhase { idle, generating, retryable, failed, rateLimited, error }

/// Result of interpreting a POST response. [narration] and [stale] are only
/// meaningful when [phase] is [GeneratePhase.idle] (a fresh generation
/// succeeded and the caller should adopt the new response wholesale).
class GenerateOutcome {
  const GenerateOutcome({required this.phase, this.narration, this.stale = false});

  final GeneratePhase phase;
  final PeriodNarration? narration;
  final bool stale;
}

/// Interpret a POST response.
///
/// THE TRAP THIS EXISTS TO AVOID: the route returns 200 with the facts
/// intact when narration generation fails (the model backed off, or
/// produced unusable output) — HTTP status is NOT the success signal. What
/// actually decides is whether `narration` came back, and `retryable` then
/// separates "try again in a moment" from "trying again will not help".
/// Mirrors review-view.ts's interpretGenerateResponse exactly.
GenerateOutcome interpretGenerateResponse(int statusCode, PeriodReviewResponse? body) {
  if (statusCode == 429) return const GenerateOutcome(phase: GeneratePhase.rateLimited);
  if (statusCode < 200 || statusCode >= 300 || body == null) {
    return const GenerateOutcome(phase: GeneratePhase.error);
  }
  if (body.narration != null) {
    return GenerateOutcome(phase: GeneratePhase.idle, narration: body.narration, stale: body.stale);
  }
  return GenerateOutcome(phase: body.retryable == true ? GeneratePhase.retryable : GeneratePhase.failed);
}

/// Label for the generate/regenerate button, given what is currently shown.
String generateButtonLabel({required bool busy, required bool hasNarration, required bool stale}) {
  if (busy) return 'Writing…';
  if (!hasNarration) return 'Generate note';
  return stale ? 'Regenerate note' : 'Rewrite note';
}

/// The message shown for a given generation phase, or null when nothing
/// needs to be said (idle — either nothing has happened yet, or the last
/// attempt succeeded and the note is on screen).
String? generatePhaseMessage(GeneratePhase phase) {
  switch (phase) {
    case GeneratePhase.idle:
    case GeneratePhase.generating:
      return null;
    case GeneratePhase.retryable:
      return 'The coaching model is busy right now. Your numbers are all here — try the note again in a moment.';
    case GeneratePhase.rateLimited:
      return "You've generated a lot of reviews recently. Try again a little later.";
    case GeneratePhase.failed:
      return "We couldn't write a note for this period. Your numbers above are unaffected.";
    case GeneratePhase.error:
      return 'Something went wrong reaching the server. Your numbers above are unaffected.';
  }
}
