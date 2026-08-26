// Pure view logic for the per-workout report (mobile mirror of
// apps/web/app/(athlete)/athlete/workouts/[id]/ReportSection.tsx,
// VerdictHeader.tsx and ComparisonRows.tsx). Kept free of Flutter widgets so
// it's unit-testable the same way the web versions are, and so the widget
// file and this file can't drift into two different state machines.

import '../../models/workout_report.dart';

// ---------------------------------------------------------------------------
// Generate/regenerate interaction state (mirrors ReportSection.tsx's
// startGenerate/finishGenerate/failGenerate — pure so the "pending never
// clears the verdict-bearing data" guarantee is directly testable).
// ---------------------------------------------------------------------------

class ReportViewState {
  const ReportViewState({
    required this.report,
    required this.pending,
    this.requestError,
  });

  final WorkoutReportResponse report;
  final bool pending;
  /// Set only on an unexpected transport failure — distinct from a modeled
  /// narration failure, which the API reports as 200 with `retryable` set.
  final String? requestError;
}

ReportViewState startGenerate(ReportViewState state) =>
    ReportViewState(report: state.report, pending: true, requestError: null);

ReportViewState finishGenerate(ReportViewState state, WorkoutReportResponse result) =>
    ReportViewState(report: result, pending: false, requestError: null);

ReportViewState failGenerate(ReportViewState state, String message) =>
    ReportViewState(report: state.report, pending: false, requestError: message);

// ---------------------------------------------------------------------------
// Narrative state machine
// ---------------------------------------------------------------------------

enum NarrativeViewKind { absent, present, stale, superseded, retryableFailed }

const supersededMessage =
    "This workout's data changed and the verdict along with it — the previous note no longer describes it.";

/// See WorkoutReportResponseSchema's own comments (packages/shared) for why
/// verdictChanged outranks stale, and both outrank a failed attempt that
/// still returned prose.
NarrativeViewKind narrativeStateFor(WorkoutReportResponse report) {
  if (report.narration == null) {
    return report.retryable != null ? NarrativeViewKind.retryableFailed : NarrativeViewKind.absent;
  }
  if (report.verdictChanged == true) return NarrativeViewKind.superseded;
  return report.stale ? NarrativeViewKind.stale : NarrativeViewKind.present;
}

/// True when this payload came back from an attempt that failed to produce a
/// fresh narrative — regardless of whether an older one survived to show.
bool attemptFailed(WorkoutReportResponse report) => report.retryable != null;

class NarrativeAffordances {
  const NarrativeAffordances({
    required this.kind,
    required this.showNote,
    required this.showStaleBadge,
    required this.supersededMessage,
    required this.retryMessage,
    required this.actionLabel,
    required this.actionDisabled,
  });

  final NarrativeViewKind kind;
  final bool showNote;
  final bool showStaleBadge;
  final String? supersededMessage;
  final String? retryMessage;
  final String? actionLabel;
  final bool actionDisabled;
}

NarrativeAffordances narrativeAffordances(WorkoutReportResponse report, bool pending) {
  final kind = narrativeStateFor(report);
  final showNote = kind == NarrativeViewKind.present || kind == NarrativeViewKind.stale;
  final showStaleBadge = kind == NarrativeViewKind.stale;
  final failed = attemptFailed(report);

  String? actionLabel;
  if (kind == NarrativeViewKind.absent) {
    actionLabel = pending ? 'Generating…' : 'Show report';
  } else if (kind == NarrativeViewKind.stale || kind == NarrativeViewKind.superseded) {
    actionLabel = pending ? 'Regenerating…' : 'Regenerate report';
  } else if (kind == NarrativeViewKind.retryableFailed && report.retryable == true) {
    actionLabel = pending ? 'Retrying…' : 'Try again';
  } else if (kind == NarrativeViewKind.present && failed && report.retryable == true) {
    // A healthy note whose refresh just failed: the note stays, but the
    // athlete still needs a way to ask again.
    actionLabel = pending ? 'Retrying…' : 'Try again';
  }

  final retryMessage = failed
      ? (report.retryable == true
          ? "We couldn't generate a narrative right now."
          : "We couldn't generate a narrative for this workout.")
      : null;

  return NarrativeAffordances(
    kind: kind,
    showNote: showNote,
    showStaleBadge: showStaleBadge,
    supersededMessage: kind == NarrativeViewKind.superseded ? supersededMessage : null,
    retryMessage: retryMessage,
    actionLabel: actionLabel,
    actionDisabled: pending,
  );
}

// ---------------------------------------------------------------------------
// Comparison rows
// ---------------------------------------------------------------------------

class DimensionRowView {
  const DimensionRowView({
    required this.key,
    required this.label,
    required this.status,
    required this.actualLabel,
    required this.prescribedLabel,
    required this.deltaLabel,
    required this.deltaPct,
  });

  final String key;
  final String label;
  final DimensionStatus status;
  final String actualLabel;
  final String prescribedLabel;
  final String deltaLabel;
  final double deltaPct;
}

const meterRangePct = 50.0;

/// Dot offset as a 0-100 percentage of the track width.
double meterOffsetPct(double deltaPct) {
  final clamped = deltaPct.clamp(-meterRangePct, meterRangePct);
  return 50 + (clamped / meterRangePct) * 50;
}

String _formatDeltaPct(double pct) {
  final rounded = pct.round();
  return rounded > 0 ? '+$rounded%' : '$rounded%';
}

String _formatLoad(double value) => '${value.round()} TSS';

/// Mirrors ComparisonRows.tsx's formatDuration (a clock-style "1:05:30" /
/// "5:30" — distinct from activity_row.dart's "1h 5m", which is the workout
/// list's own convention, not this screen's).
String formatDurationClock(double seconds) {
  final total = seconds.round();
  final h = total ~/ 3600;
  final m = (total % 3600) ~/ 60;
  final s = total % 60;
  final mStr = m.toString().padLeft(h > 0 ? 2 : 1, '0');
  final sStr = s.toString().padLeft(2, '0');
  if (h > 0) return '$h:$mStr:$sStr';
  return '$mStr:$sStr';
}

String _formatIntensityValue(double value, IntensityTargetKind kind) {
  switch (kind) {
    case IntensityTargetKind.ftpPct:
      return '${value.round()}% FTP';
    case IntensityTargetKind.zone:
      return '${value.round()}% HR max';
    case IntensityTargetKind.paceSPerKm:
      final m = (value / 60).floor();
      final s = (value % 60).round();
      return '$m:${s.toString().padLeft(2, '0')} /km';
  }
}

String _formatIntensityTargetLabel(IntensityTarget target) {
  switch (target.kind) {
    case IntensityTargetKind.ftpPct:
      return '${target.value.round()}% FTP target';
    case IntensityTargetKind.zone:
      return 'Zone ${target.value.round()} target';
    case IntensityTargetKind.paceSPerKm:
      final m = (target.value / 60).floor();
      final s = (target.value % 60).round();
      return '$m:${s.toString().padLeft(2, '0')} /km target';
  }
}

DimensionRowView? _durationRow(DimensionDelta d) {
  if (d.status == DimensionStatus.unavailable) return null;
  return DimensionRowView(
    key: 'duration',
    label: 'Duration',
    status: d.status,
    actualLabel: formatDurationClock(d.actual!),
    prescribedLabel: formatDurationClock(d.prescribed!),
    deltaLabel: _formatDeltaPct(d.deltaPct!),
    deltaPct: d.deltaPct!,
  );
}

DimensionRowView? _loadRow(DimensionDelta d) {
  if (d.status == DimensionStatus.unavailable) return null;
  return DimensionRowView(
    key: 'load',
    label: 'Load',
    status: d.status,
    actualLabel: _formatLoad(d.actual!),
    prescribedLabel: _formatLoad(d.prescribed!),
    deltaLabel: _formatDeltaPct(d.deltaPct!),
    deltaPct: d.deltaPct!,
  );
}

DimensionRowView? _intensityRow(IntensityDimensionDelta d) {
  if (d.status == DimensionStatus.unavailable) return null;
  return DimensionRowView(
    key: 'intensity',
    label: 'Intensity (${_formatIntensityTargetLabel(d.target!)})',
    status: d.status,
    actualLabel: _formatIntensityValue(d.actual!, d.target!.kind),
    prescribedLabel: _formatIntensityValue(d.prescribed!, d.target!.kind),
    deltaLabel: _formatDeltaPct(d.deltaPct!),
    deltaPct: d.deltaPct!,
  );
}

/// Every visible comparison row, in a fixed order (duration, load,
/// intensity). Unmatched deltas and fully-unavailable matched deltas both
/// yield `[]` — the widget treats an empty list as "render nothing".
List<DimensionRowView> visibleDimensionRows(ExecutionDelta delta) {
  if (!delta.matched) return const [];
  final dims = delta.dimensions!;
  final rows = <DimensionRowView>[];
  final duration = _durationRow(dims.duration);
  if (duration != null) rows.add(duration);
  final load = _loadRow(dims.load);
  if (load != null) rows.add(load);
  final intensity = _intensityRow(dims.intensity);
  if (intensity != null) rows.add(intensity);
  return rows;
}

// ---------------------------------------------------------------------------
// Verdict header
// ---------------------------------------------------------------------------

enum VerdictTone { positive, warning, neutral }

VerdictTone verdictTone(VerdictCode code) {
  switch (code) {
    case VerdictCode.executedAsPrescribed:
      return VerdictTone.positive;
    case VerdictCode.underExecuted:
    case VerdictCode.overExecuted:
      return VerdictTone.warning;
    case VerdictCode.partialData:
    case VerdictCode.unplannedEffort:
      return VerdictTone.neutral;
  }
}

String verdictLabel(VerdictCode code) {
  switch (code) {
    case VerdictCode.executedAsPrescribed:
      return 'As prescribed';
    case VerdictCode.underExecuted:
      return 'Under target';
    case VerdictCode.overExecuted:
      return 'Over target';
    case VerdictCode.partialData:
      return 'Partial data';
    case VerdictCode.unplannedEffort:
      return 'Unplanned';
  }
}
