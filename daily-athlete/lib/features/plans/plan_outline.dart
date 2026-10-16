import 'package:flutter/material.dart';

import '../../models/plan_view.dart';
import '../../models/sport.dart';
import '../../models/workout_report.dart' show Verdict;
import '../activities/activity_row.dart' show sportIcon;
import 'plan_view_format.dart';

class PlanOutline extends StatefulWidget {
  const PlanOutline({super.key, required this.weeks, required this.verdictsUnavailable});

  final List<PlanViewWeek> weeks;
  final bool verdictsUnavailable;

  @override
  State<PlanOutline> createState() => _PlanOutlineState();
}

class _PlanOutlineState extends State<PlanOutline> {
  final GlobalKey _currentWeekKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = _currentWeekKey.currentContext;
      if (!mounted || target == null) return;
      Scrollable.ensureVisible(target, duration: const Duration(milliseconds: 250), alignment: 0.1);
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (widget.weeks.isEmpty) {
      return Text(
        noWorkoutsCopy,
        style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.verdictsUnavailable)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              'Verdicts unavailable right now',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        for (final week in widget.weeks)
          _WeekTile(
            key: week.current ? _currentWeekKey : null,
            week: week,
            hasVerdictError: widget.verdictsUnavailable,
          ),
      ],
    );
  }
}

class _WeekTile extends StatelessWidget {
  const _WeekTile({super.key, required this.week, required this.hasVerdictError});

  final PlanViewWeek week;
  final bool hasVerdictError;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final phase = phaseLabel(week.phase);
    final skipped = skippedText(week.skippedCount);
    final emptyMessage = weekEmptyMessage(week, hasVerdictError: hasVerdictError);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      clipBehavior: Clip.antiAlias,
      child: ExpansionTile(
        initiallyExpanded: week.current,
        shape: const Border(),
        collapsedShape: const Border(),
        title: Row(
          children: [
            Flexible(
              child: Text(
                weekLabel(week.start),
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: week.current ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
            if (phase != null) ...[
              const SizedBox(width: 8),
              Text(phase, style: theme.textTheme.labelMedium?.copyWith(color: muted)),
            ],
          ],
        ),
        subtitle: _WeekSummary(week: week, skipped: skipped),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (week.focus.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(week.focus, style: theme.textTheme.bodySmall?.copyWith(color: muted)),
            ),
          if (emptyMessage != null)
            Text(emptyMessage, style: theme.textTheme.bodySmall?.copyWith(color: muted)),
          for (final session in week.sessions) _SessionRow(session: session),
        ],
      ),
    );
  }
}

class _WeekSummary extends StatelessWidget {
  const _WeekSummary({required this.week, required this.skipped});

  final PlanViewWeek week;
  final String? skipped;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final compliance = week.compliance;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 4),
        Row(
          children: [
            Expanded(
              child: Text(
                hoursExecutedOfPlanned(week.executedSeconds, week.plannedSeconds),
                style: theme.textTheme.bodySmall?.copyWith(color: muted),
              ),
            ),
            Text(compliancePercentText(compliance), style: theme.textTheme.labelLarge),
          ],
        ),
        const SizedBox(height: 4),
        Semantics(
          label: complianceSemantics(compliance, week.executedSeconds, week.dueSeconds),
          child: ExcludeSemantics(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(value: complianceBarFraction(compliance), minHeight: 6),
            ),
          ),
        ),
        if (isAheadOfPlan(compliance) || skipped != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Wrap(
              spacing: 12,
              children: [
                if (isAheadOfPlan(compliance))
                  Text('Ahead of plan', style: theme.textTheme.bodySmall?.copyWith(color: muted)),
                if (skipped != null) Text(skipped!, style: theme.textTheme.bodySmall?.copyWith(color: muted)),
              ],
            ),
          ),
      ],
    );
  }
}

class _SessionRow extends StatefulWidget {
  const _SessionRow({required this.session});

  final PlanViewSession session;

  @override
  State<_SessionRow> createState() => _SessionRowState();
}

class _SessionRowState extends State<_SessionRow> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final session = widget.session;
    final sport = Sport.fromString(session.sport);
    final rationale = session.rationale;
    final load = session.plannedLoad;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(sportIcon(sport), color: sport.color, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(sport.displayName, style: theme.textTheme.bodyMedium),
                Text(sessionMeta(session), style: theme.textTheme.bodySmall?.copyWith(color: muted)),
                if (load != null)
                  Text('Planned load ${load.round()}', style: theme.textTheme.bodySmall?.copyWith(color: muted)),
                if (rationale != null)
                  InkWell(
                    onTap: () => setState(() => _expanded = !_expanded),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(minHeight: 44),
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          rationale,
                          maxLines: _expanded ? null : 2,
                          overflow: _expanded ? TextOverflow.visible : TextOverflow.ellipsis,
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (session.verdict != null) ...[
            const SizedBox(width: 8),
            _VerdictChip(verdict: session.verdict!),
          ],
        ],
      ),
    );
  }
}

class _VerdictChip extends StatelessWidget {
  const _VerdictChip({required this.verdict});

  final Verdict verdict;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final label = verdictChipLabel(verdict.code);
    return Semantics(
      label: 'Verdict: $label',
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: theme.colorScheme.secondaryContainer,
            borderRadius: BorderRadius.circular(999),
          ),
          child: Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSecondaryContainer),
          ),
        ),
      ),
    );
  }
}
