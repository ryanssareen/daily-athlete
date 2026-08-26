// Period review detail screen (mobile mirror of
// apps/web/app/(athlete)/athlete/reports/[kind]/[periodKey]/page.tsx +
// review-sections.tsx / review-detail.tsx). The facts render unconditionally
// from [PeriodReviewViewState.response]; only the narration section reacts
// to [GeneratePhase] — same KTD2 split as report_section.dart's verdict vs.
// narrative areas.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/period_review.dart';
import 'reports_providers.dart';
import 'reports_view.dart';

class ReportDetailScreen extends ConsumerWidget {
  const ReportDetailScreen({super.key, required this.kind, required this.periodKey});

  final PeriodKind kind;
  final String periodKey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final args = (kind: kind, periodKey: periodKey);
    final stateAsync = ref.watch(periodReviewProvider(args));

    return Scaffold(
      appBar: AppBar(title: const Text('Report'), centerTitle: false),
      body: stateAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(
          child: _ErrorView(
            error: err.toString(),
            onRetry: () => ref.invalidate(periodReviewProvider(args)),
          ),
        ),
        data: (state) => RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(periodReviewProvider(args));
            await ref.read(periodReviewProvider(args).future);
          },
          child: _ReportDetailBody(state: state, args: args),
        ),
      ),
    );
  }
}

class _ReportDetailBody extends ConsumerWidget {
  const _ReportDetailBody({required this.state, required this.args});

  final PeriodReviewViewState state;
  final PeriodReviewArgs args;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final facts = state.response.facts;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Text(periodLabel(facts.kind, facts.bounds), style: theme.textTheme.headlineSmall),
        const SizedBox(height: 4),
        Text(
          '${facts.bounds.start} to ${facts.bounds.end}',
          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 20),
        _StatGrid(facts: facts),
        const SizedBox(height: 16),
        _Section(
          title: 'Against your plan',
          child: _AgainstPlanSection(facts: facts),
        ),
        const SizedBox(height: 12),
        _Section(title: 'By sport', child: _SportTable(sports: facts.sports)),
        const SizedBox(height: 12),
        _Section(
          title: facts.kind == PeriodKind.weekly ? 'Versus last week' : 'Versus last month',
          child: _ComparisonSection(comparison: facts.comparison),
        ),
        const SizedBox(height: 12),
        _Section(
          title: "Coach's note",
          child: _NarrationSection(state: state, args: args),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Stat grid
// ---------------------------------------------------------------------------

class _StatGrid extends StatelessWidget {
  const _StatGrid({required this.facts});
  final PeriodFacts facts;

  @override
  Widget build(BuildContext context) {
    final totals = facts.totals;
    final items = <(String, String, String?)>[
      ('Sessions', '${totals.sessions}', null),
      ('Time', formatDuration(totals.durationS), null),
      ('Distance', formatDistance(totals.distanceM), null),
      ('Load', '${totals.load.round()}', loadHint(totals.loadConfidence)),
      ('Active days', '${totals.activeDays}', null),
    ];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 1.7,
      children: items.map((i) => _StatTile(label: i.$1, value: i.$2, hint: i.$3)).toList(),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.label, required this.value, this.hint});
  final String label;
  final String value;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            label.toUpperCase(),
            style: theme.textTheme.labelSmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 4),
          Text(value, style: theme.textTheme.titleLarge),
          if (hint != null)
            Text(hint!, style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Section shell
// ---------------------------------------------------------------------------

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title.toUpperCase(),
              style: theme.textTheme.labelSmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant, letterSpacing: 1),
            ),
            const SizedBox(height: 10),
            child,
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Against your plan
// ---------------------------------------------------------------------------

class _AgainstPlanSection extends StatelessWidget {
  const _AgainstPlanSection({required this.facts});
  final PeriodFacts facts;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final compliance = facts.compliance;
    return Column(
      children: [
        _Row(
          label: 'Prescribed sessions completed',
          value: Text.rich(
            TextSpan(
              style: theme.textTheme.bodyMedium,
              children: [
                TextSpan(text: '${compliance.completed} of ${compliance.prescribed}'),
                if (compliance.unplanned > 0)
                  TextSpan(
                    text: ' (+${compliance.unplanned} unplanned)',
                    style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                  ),
              ],
            ),
          ),
        ),
        _MetricRow(label: 'Time', metric: facts.duration, format: formatDuration),
        _MetricRow(label: 'Load', metric: facts.load, format: (n) => '${n.round()}'),
      ],
    );
  }
}

class _MetricRow extends StatelessWidget {
  const _MetricRow({required this.label, required this.metric, required this.format});
  final String label;
  final PeriodMetric metric;
  final String Function(double) format;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (metric.status == PeriodMetricStatus.unavailable) {
      return _Row(
        label: label,
        value: Text(
          'not comparable — nothing was prescribed',
          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      );
    }
    return _Row(
      label: label,
      value: Text.rich(
        TextSpan(
          style: theme.textTheme.bodyMedium,
          children: [
            TextSpan(text: '${format(metric.actual!)} of ${format(metric.prescribed!)} '),
            TextSpan(
              text: '(${formatDelta(metric.deltaPct!)})',
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});
  final String label;
  final Widget value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(child: Text(label, style: Theme.of(context).textTheme.bodyMedium)),
          Flexible(child: Align(alignment: Alignment.centerRight, child: value)),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sport table
// ---------------------------------------------------------------------------

class _SportTable extends StatelessWidget {
  const _SportTable({required this.sports});
  final List<PeriodSportRollup> sports;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (sports.isEmpty) {
      return Text(
        'No sessions logged in this period.',
        style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      );
    }
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: DataTable(
        columnSpacing: 20,
        columns: const [
          DataColumn(label: Text('Sport')),
          DataColumn(label: Text('Sessions'), numeric: true),
          DataColumn(label: Text('Time'), numeric: true),
          DataColumn(label: Text('Distance'), numeric: true),
          DataColumn(label: Text('Load'), numeric: true),
        ],
        rows: sports
            .map(
              (s) => DataRow(cells: [
                DataCell(Text(s.sport.displayName)),
                DataCell(Text('${s.sessions}')),
                DataCell(Text(formatDuration(s.durationS))),
                DataCell(Text(formatDistance(s.distanceM))),
                DataCell(Text('${s.load.round()}')),
              ]),
            )
            .toList(),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Comparison to previous period
// ---------------------------------------------------------------------------

class _ComparisonSection extends StatelessWidget {
  const _ComparisonSection({required this.comparison});
  final PeriodComparison comparison;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (!comparison.available) {
      return Text(
        'No earlier period to compare against yet.',
        style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
      );
    }
    final activeDaysDelta = comparison.activeDaysDelta!;
    return Column(
      children: [
        _Row(
          label: 'Sessions',
          value: Text(formatDelta(comparison.sessionsDeltaPct!),
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
        ),
        _Row(
          label: 'Time',
          value: Text(formatDelta(comparison.durationDeltaPct!),
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
        ),
        _Row(
          label: 'Load',
          value: Text(formatDelta(comparison.loadDeltaPct!),
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
        ),
        _Row(
          label: 'Active days',
          value: Text('${activeDaysDelta > 0 ? '+' : ''}$activeDaysDelta',
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Narration — the only interactive part of this screen
// ---------------------------------------------------------------------------

class _NarrationSection extends ConsumerWidget {
  const _NarrationSection({required this.state, required this.args});

  final PeriodReviewViewState state;
  final PeriodReviewArgs args;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final response = state.response;
    final narration = response.narration;
    final busy = state.phase == GeneratePhase.generating;
    final message = generatePhaseMessage(state.phase);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (narration != null) ...[
          if (response.stale)
            _Callout(
              text:
                  'This note was written before some of the numbers above changed. Regenerate it for an up-to-date read.',
            ),
          if (response.stale) const SizedBox(height: 10),
          Text(narration.note, style: theme.textTheme.bodyMedium?.copyWith(height: 1.5)),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.only(left: 12),
            decoration: BoxDecoration(
              border: Border(left: BorderSide(color: theme.colorScheme.surfaceContainerHighest, width: 3)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'NEXT PERIOD',
                  style: theme.textTheme.labelSmall
                      ?.copyWith(color: theme.colorScheme.onSurfaceVariant, letterSpacing: 1),
                ),
                const SizedBox(height: 2),
                Text(narration.takeaway, style: theme.textTheme.bodyMedium?.copyWith(height: 1.5)),
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
        if (narration == null && !busy)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              'The numbers above are ready. Generate a coach\'s note to go with them.',
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ),
        if (message != null) ...[
          _Callout(text: message, isError: state.phase == GeneratePhase.error || state.phase == GeneratePhase.failed),
          const SizedBox(height: 12),
        ],
        FilledButton(
          onPressed: busy ? null : () => ref.read(periodReviewProvider(args).notifier).generate(),
          child: Text(
            generateButtonLabel(busy: busy, hasNarration: narration != null, stale: response.stale),
          ),
        ),
      ],
    );
  }
}

class _Callout extends StatelessWidget {
  const _Callout({required this.text, this.isError = false});
  final String text;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = isError ? theme.colorScheme.error : theme.colorScheme.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(text, style: theme.textTheme.bodySmall?.copyWith(color: color)),
    );
  }
}

// ---------------------------------------------------------------------------
// Error state (initial load failure)
// ---------------------------------------------------------------------------

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.error, required this.onRetry});
  final String error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.cloud_off_outlined, size: 48, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Could not load this report', style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(
            error,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Retry')),
        ],
      ),
    );
  }
}
