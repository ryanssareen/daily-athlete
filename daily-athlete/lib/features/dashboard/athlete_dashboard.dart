import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/layout.dart';
import '../settings/units_notifier.dart';
import '../shared/screen_header.dart';
import 'dashboard_providers.dart';
import 'home_cards.dart';
import 'home_format.dart';
import 'overview_api.dart';

/// Athlete-facing Home. When [athleteId] is provided, fetches data for that
/// specific athlete (used by coaches via AthleteDetailScreen). When null,
/// resolves the current user's id from auth and shows the full Home.
class AthleteDashboard extends ConsumerWidget {
  const AthleteDashboard({super.key, this.athleteId});

  final String? athleteId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isOwnHome = athleteId == null;
    final dataAsync = isOwnHome
        ? ref.watch(myDashboardProvider)
        : ref.watch(athleteDashboardProvider(athleteId!));
    final overview = isOwnHome
        ? ref.watch(athleteOverviewProvider).valueOrNull
        : null;
    final unit = ref.watch(unitsNotifierProvider).valueOrNull?.distance ?? 'km';
    final now = DateTime.now();

    Future<void> refresh() async {
      if (isOwnHome) {
        ref.invalidate(myDashboardProvider);
        ref.invalidate(athleteOverviewProvider);
        await ref.read(myDashboardProvider.future);
      } else {
        ref.invalidate(athleteDashboardProvider(athleteId!));
        await ref.read(athleteDashboardProvider(athleteId!).future);
      }
    }

    final content = dataAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, stack) {
        debugPrint('AthleteDashboard: failed to load — $err\n$stack');
        return Center(
          child: _ErrorView(error: err.toString(), onRetry: refresh),
        );
      },
      data: (data) {
        final hero = WeekHeroCard(
          completed: data.weekCompleted,
          now: now,
          streakDays: data.streakDays,
          distanceUnit: unit,
        );
        final plan = PlanCard(
          plan: data.activePlan,
          race: overview?.race,
          aheadCount: data.plannedAheadCount,
          nextWorkout: data.nextWorkout,
          now: now,
        );
        final form = overview != null && overview.hasData
            ? FormCard(overview: overview)
            : null;
        final recent = RecentSection(
          workouts: data.recent,
          now: now,
          distanceUnit: unit,
        );

        if (context.layout != LayoutSize.compact) {
          return RefreshIndicator(
            onRefresh: refresh,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(28, 4, 28, 28),
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      flex: 7,
                      child: Column(
                        children: [hero, const SizedBox(height: 16), plan],
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      flex: 5,
                      child: Column(
                        children: [
                          if (form != null) ...[
                            form,
                            const SizedBox(height: 16),
                          ],
                          recent,
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: refresh,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
            children: [
              hero,
              const SizedBox(height: 16),
              plan,
              if (form != null) ...[const SizedBox(height: 16), form],
              const SizedBox(height: 16),
              recent,
            ],
          ),
        );
      },
    );

    if (!isOwnHome) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Athlete Dashboard'),
          centerTitle: false,
        ),
        body: content,
      );
    }

    final name = overview?.firstName;
    final greeting = overview?.greeting ?? localGreeting(now);
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            ScreenHeader(
              eyebrow: eyebrowDate(now),
              title: name == null ? '$greeting.' : '$greeting, $name.',
              trailing: SettingsAvatarButton(initial: name),
            ),
            Expanded(child: content),
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
            size: 56,
            color: theme.colorScheme.error,
          ),
          const SizedBox(height: 16),
          Text(
            'Failed to load dashboard',
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
