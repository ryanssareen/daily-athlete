// Reports list screen (mobile mirror of
// apps/web/app/(athlete)/athlete/reports/page.tsx) — the athlete's recent
// weekly and monthly periods, one row each, with a "Note ready" / "Not yet
// written" status and a headline stat. Tapping a row opens
// report_detail_screen.dart for that period.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../calendar/year_heatmap_view.dart';
import '../dashboard/overview_api.dart';
import '../shared/eyebrow.dart';
import '../shared/screen_header.dart';
import 'reports_providers.dart';
import 'reports_sections.dart';
import 'reports_view.dart';

class ReportsListScreen extends ConsumerWidget {
  const ReportsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final periodsAsync = ref.watch(periodReviewListProvider);
    final overview = ref.watch(athleteOverviewProvider).valueOrNull;

    Future<void> refresh() async {
      ref.invalidate(periodReviewListProvider);
      ref.invalidate(athleteOverviewProvider);
      await ref.read(periodReviewListProvider.future);
    }

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            ScreenHeader(
              title: 'Reports',
              bottom: Text(
                'Where your training stands, and how each week went against your plan.',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            Expanded(
              child: periodsAsync.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (err, stack) => Center(
                  child: _ErrorView(error: err.toString(), onRetry: refresh),
                ),
                data: (periods) {
                  final hasOverview = overview != null && overview.hasData;
                  if (!hasAnyTraining(periods) && !hasOverview) {
                    return const _EmptyState();
                  }
                  final reviews = [
                    for (var i = 0; i < periods.length; i++)
                      ReviewCard(
                        summary: periods[i],
                        previous: previousOfKind(periods, i),
                      ),
                  ];
                  final weeklyBars = weeklyLoadBars(periods);
                  return RefreshIndicator(
                    onRefresh: refresh,
                    child: LayoutBuilder(
                      builder: (context, constraints) {
                        final wide = constraints.maxWidth >= _wideMinWidth;
                        return ListView(
                          padding: EdgeInsets.fromLTRB(
                            wide ? 28 : 20,
                            8,
                            wide ? 28 : 20,
                            24,
                          ),
                          children: [
                            if (weeklyBars.length >= 2) ...[
                              WeeklyLoadCard(bars: weeklyBars),
                              const SizedBox(height: 16),
                            ],
                            if (hasOverview) ...[
                              KpiGrid(overview: overview),
                              if (overview.race != null) ...[
                                const SizedBox(height: 16),
                                GoalEventStrip(race: overview.race!),
                              ],
                              const SizedBox(height: 16),
                              if (wide) ...[
                                _Pair(
                                  left: FormChartCard(overview: overview),
                                  right: BySportCard(sports: overview.sports),
                                ),
                                const SizedBox(height: 16),
                                WeeklyHoursCard(weekly: overview.weekly),
                                const SizedBox(height: 16),
                                const _HeatmapCard(),
                              ] else ...[
                                FormChartCard(overview: overview),
                                const SizedBox(height: 16),
                                WeeklyHoursCard(weekly: overview.weekly),
                                const SizedBox(height: 16),
                                BySportCard(sports: overview.sports),
                                const SizedBox(height: 16),
                                const _HeatmapCard(),
                              ],
                              const SizedBox(height: 20),
                            ],
                            const Eyebrow('Weekly & monthly reviews'),
                            const SizedBox(height: 8),
                            if (wide)
                              _ReviewGrid(cards: reviews)
                            else
                              for (var i = 0; i < reviews.length; i++) ...[
                                if (i > 0) const SizedBox(height: 10),
                                reviews[i],
                              ],
                          ],
                        );
                      },
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.summarize_outlined,
              size: 48,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 16),
            Text('No reports yet', style: theme.textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              "Once you've logged a week of training, your weekly and monthly reviews show up here.",
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

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
          Icon(
            Icons.cloud_off_outlined,
            size: 48,
            color: theme.colorScheme.error,
          ),
          const SizedBox(height: 16),
          Text(
            'Could not load reports',
            style: theme.textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            error,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          FilledButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

/// Content width at which Reports switches to a two-column dashboard.
const double _wideMinWidth = 760;

/// Two cards side by side, the left one wider (charts read better wide).
class _Pair extends StatelessWidget {
  const _Pair({required this.left, required this.right});

  final Widget left;
  final Widget right;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(flex: 3, child: left),
        const SizedBox(width: 16),
        Expanded(flex: 2, child: right),
      ],
    );
  }
}

/// Year-at-a-glance training heatmap (the Calendar's Year view, in a card).
class _HeatmapCard extends StatelessWidget {
  const _HeatmapCard();

  @override
  Widget build(BuildContext context) {
    return const SectionCard(
      title: 'Training heatmap',
      note: 'Daily training time over the last 12 months.',
      child: YearHeatmapView(),
    );
  }
}

class _ReviewGrid extends StatelessWidget {
  const _ReviewGrid({required this.cards});

  final List<Widget> cards;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < cards.length; i += 2) ...[
          if (i > 0) const SizedBox(height: 12),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: cards[i]),
                const SizedBox(width: 12),
                Expanded(
                  child: i + 1 < cards.length ? cards[i + 1] : const SizedBox(),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}
