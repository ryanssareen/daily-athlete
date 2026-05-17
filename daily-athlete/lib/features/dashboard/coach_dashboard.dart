import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../router/routes.dart';
import 'athlete_roster_card.dart';
import 'dashboard_providers.dart';

/// Coach-facing dashboard: displays the roster of linked athletes with
/// weekly compliance summaries.  Tapping a card navigates to
/// /dashboard/athlete/:id (AthleteDetailScreen).
class CoachDashboard extends ConsumerWidget {
  const CoachDashboard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rosterAsync = ref.watch(coachRosterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Coach Dashboard'),
        centerTitle: false,
      ),
      body: rosterAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(
          child: _ErrorView(
            error: err.toString(),
            onRetry: () => ref.invalidate(coachRosterProvider),
          ),
        ),
        data: (roster) {
          if (roster.isEmpty) {
            return const _EmptyRosterView();
          }
          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(coachRosterProvider);
              await ref.read(coachRosterProvider.future);
            },
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              itemCount: roster.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final entry = roster[index];
                return AthleteRosterCard(
                  entry: entry,
                  onTap: () => context.go(
                    Routes.athleteDetail.replaceFirst(':id', entry.athleteId),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

class _EmptyRosterView extends StatelessWidget {
  const _EmptyRosterView();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.group_outlined,
                size: 64, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: 16),
            Text(
              'No athletes yet',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              'Invite athletes via the Settings tab to see their training here.',
              style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant),
              textAlign: TextAlign.center,
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
          Icon(Icons.cloud_off_outlined,
              size: 56, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Failed to load roster',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(error,
              style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant),
              textAlign: TextAlign.center),
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
