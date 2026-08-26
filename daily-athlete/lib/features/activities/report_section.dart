// Per-workout AI report (Unit U7 mirror) — verdict + prescribed-vs-actual
// comparison + generated narrative, for the workout detail screen. Ports
// apps/web/app/(athlete)/athlete/workouts/[id]/{ReportSection,VerdictHeader,
// ComparisonRows}.tsx onto this app's existing HTTP/Riverpod-free stateful-
// widget convention (see WorkoutActionSheet for the same GET+action shape).
//
// KTD2 guard, same as the web version: the verdict + comparison render from
// `state.report.delta` unconditionally, never gated on `pending` — only the
// narrative area below has a loading state.

import 'dart:async';

import 'package:flutter/material.dart';

import '../../models/workout_report.dart';
import 'report_view.dart';
import 'use_workout_report.dart';

class ReportSection extends StatefulWidget {
  const ReportSection({super.key, required this.workoutId});

  final String workoutId;

  @override
  State<ReportSection> createState() => _ReportSectionState();
}

class _ReportSectionState extends State<ReportSection> {
  ReportViewState? _state;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _state = null;
      _loadError = null;
    });
    try {
      final report = await fetchWorkoutReport(widget.workoutId);
      if (!mounted) return;
      setState(() => _state = ReportViewState(report: report, pending: false));
      // Mirrors ReportSection.tsx's mount-time auto-generate: an "absent"
      // narrative (never attempted) generates immediately, no button tap
      // needed for the common first-view case.
      if (narrativeStateFor(report) == NarrativeViewKind.absent) {
        unawaited(_generate());
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadError = "Couldn't load the report.");
    }
  }

  Future<void> _generate() async {
    final current = _state;
    if (current == null) return;
    setState(() => _state = startGenerate(current));
    try {
      final result = await generateWorkoutReport(widget.workoutId);
      if (!mounted) return;
      setState(() => _state = finishGenerate(_state!, result));
    } catch (_) {
      if (!mounted) return;
      setState(() => _state = failGenerate(_state!, "Couldn't generate the report. Try again."));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loadError != null) {
      return _ErrorCard(message: _loadError!, onRetry: _load);
    }
    final state = _state;
    if (state == null) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    final report = state.report;
    final aff = narrativeAffordances(report, state.pending);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('DEBRIEF',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant, letterSpacing: 1)),
            const SizedBox(height: 2),
            Text('Report', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            _VerdictHeader(verdict: report.delta.verdict),
            const SizedBox(height: 12),
            if (report.delta.matched)
              _ComparisonRows(delta: report.delta)
            else
              Text('Freeform · not compared to a plan',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 12),
            if (state.pending && !aff.showNote) const _NarrativeSkeleton(),
            if (aff.showNote && report.narration != null) ...[
              Text(report.narration!.note, style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: 8),
              Text.rich(
                TextSpan(
                  style: Theme.of(context).textTheme.bodyMedium,
                  children: [
                    const TextSpan(text: 'Takeaway — ', style: TextStyle(fontWeight: FontWeight.bold)),
                    TextSpan(text: report.narration!.takeaway),
                  ],
                ),
              ),
            ],
            if (aff.supersededMessage != null) ...[
              const SizedBox(height: 8),
              Text(aff.supersededMessage!,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                      fontStyle: FontStyle.italic)),
            ],
            if (aff.showStaleBadge) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text('Out of date', style: Theme.of(context).textTheme.labelSmall),
                  ),
                  if (aff.actionLabel != null) ...[
                    const SizedBox(width: 8),
                    TextButton(
                      onPressed: aff.actionDisabled ? null : _generate,
                      child: Text(aff.actionLabel!),
                    ),
                  ],
                ],
              ),
            ],
            if ((aff.kind == NarrativeViewKind.absent || aff.kind == NarrativeViewKind.superseded) &&
                aff.actionLabel != null) ...[
              const SizedBox(height: 8),
              FilledButton(
                onPressed: aff.actionDisabled ? null : _generate,
                child: Text(aff.actionLabel!),
              ),
            ],
            if (aff.retryMessage != null) ...[
              const SizedBox(height: 8),
              Text(aff.retryMessage!,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: Theme.of(context).colorScheme.error)),
              if (aff.actionLabel != null &&
                  (aff.kind == NarrativeViewKind.retryableFailed ||
                      aff.kind == NarrativeViewKind.present)) ...[
                const SizedBox(height: 4),
                TextButton(
                  onPressed: aff.actionDisabled ? null : _generate,
                  child: Text(aff.actionLabel!),
                ),
              ],
            ],
            if (state.requestError != null) ...[
              const SizedBox(height: 8),
              Text(state.requestError!,
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: Theme.of(context).colorScheme.error)),
            ],
          ],
        ),
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(message, style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 8),
            TextButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}

class _NarrativeSkeleton extends StatelessWidget {
  const _NarrativeSkeleton();

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.surfaceContainerHighest;
    Widget bar(double widthFactor) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: FractionallySizedBox(
            widthFactor: widthFactor,
            alignment: Alignment.centerLeft,
            child: Container(height: 12, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(6))),
          ),
        );
    return Semantics(
      label: 'Generating report',
      liveRegion: true,
      child: Column(children: [bar(1), bar(0.9), bar(0.6)]),
    );
  }
}

// ---------------------------------------------------------------------------
// Verdict header
// ---------------------------------------------------------------------------

class _VerdictHeader extends StatelessWidget {
  const _VerdictHeader({required this.verdict});
  final Verdict verdict;

  Color _toneColor(VerdictTone tone, ColorScheme scheme) {
    switch (tone) {
      case VerdictTone.positive:
        return Colors.green.shade600;
      case VerdictTone.warning:
        return Colors.orange.shade700;
      case VerdictTone.neutral:
        return scheme.onSurfaceVariant;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tone = verdictTone(verdict.code);
    final color = _toneColor(tone, theme.colorScheme);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
        border: Border(left: BorderSide(color: color, width: 4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(verdictLabel(verdict.code),
              style: theme.textTheme.labelSmall?.copyWith(color: color, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text(verdict.headline, style: theme.textTheme.titleSmall),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Comparison rows
// ---------------------------------------------------------------------------

class _ComparisonRows extends StatelessWidget {
  const _ComparisonRows({required this.delta});
  final ExecutionDelta delta;

  Color _statusColor(DimensionStatus status, ColorScheme scheme) {
    switch (status) {
      case DimensionStatus.onTarget:
        return Colors.green.shade600;
      case DimensionStatus.under:
      case DimensionStatus.over:
        return Colors.orange.shade700;
      case DimensionStatus.unavailable:
        return scheme.onSurfaceVariant;
    }
  }

  @override
  Widget build(BuildContext context) {
    final rows = visibleDimensionRows(delta);
    if (rows.isEmpty) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return Column(
      children: rows
          .map(
            (row) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(row.label, style: theme.textTheme.bodyMedium),
                      Text.rich(
                        TextSpan(
                          style: theme.textTheme.bodyMedium,
                          children: [
                            TextSpan(text: row.actualLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
                            TextSpan(text: '  vs  ', style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                            TextSpan(text: row.prescribedLabel, style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  _Meter(deltaPct: row.deltaPct, color: _statusColor(row.status, theme.colorScheme)),
                  const SizedBox(height: 2),
                  Text(row.deltaLabel,
                      style: theme.textTheme.labelSmall
                          ?.copyWith(color: _statusColor(row.status, theme.colorScheme))),
                ],
              ),
            ),
          )
          .toList(),
    );
  }
}

class _Meter extends StatelessWidget {
  const _Meter({required this.deltaPct, required this.color});
  final double deltaPct;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final offsetPct = meterOffsetPct(deltaPct);
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        const dotSize = 10.0;
        return SizedBox(
          height: dotSize,
          child: Stack(
            alignment: Alignment.centerLeft,
            children: [
              Container(
                height: 3,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Positioned(
                left: (offsetPct / 100 * width - dotSize / 2).clamp(0, width - dotSize),
                child: Container(
                  width: dotSize,
                  height: dotSize,
                  decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
