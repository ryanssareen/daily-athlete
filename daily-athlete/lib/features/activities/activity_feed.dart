import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/completed_workout.dart';
import '../../models/sport.dart';
import '../activities/activities_providers.dart';
import '../activities/activity_row.dart';
import '../activities/activity_detail_screen.dart';

/// Sport filter tab definition.
const _sportTabs = <({String label, Sport? sport})>[
  (label: 'All', sport: null),
  (label: 'Run', sport: Sport.run),
  (label: 'Ride', sport: Sport.bike),
  (label: 'Swim', sport: Sport.swim),
  (label: 'Strength', sport: Sport.strength),
  (label: 'Other', sport: Sport.other),
];

/// Chronological activity feed with sport filter tabs (R4, R5).
///
/// Owned by [ActivitiesTab]. Handles its own tab state via
/// [sportFilterProvider]. Tapping a row pushes [ActivityDetailScreen].
class ActivityFeed extends ConsumerWidget {
  const ActivityFeed({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedAsync = ref.watch(filteredFeedProvider);
    final selectedSport = ref.watch(sportFilterProvider);

    return Column(
      children: [
        // Sport filter tab bar (R5)
        _SportFilterBar(selected: selectedSport),

        // Feed list
        Expanded(
          child: feedAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (err, _) => Center(
              child: Text(
                'Failed to load activities.\n$err',
                textAlign: TextAlign.center,
              ),
            ),
            data: (rows) {
              if (rows.isEmpty) {
                return const _EmptyFeed();
              }
              return RefreshIndicator(
                onRefresh: () =>
                    ref.refresh(activityFeedProvider.future),
                child: ListView.separated(
                  padding: const EdgeInsets.only(bottom: 80),
                  itemCount: rows.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, i) {
                    final workout = rows[i];
                    return ActivityRow(
                      workout: workout,
                      onTap: () => _openDetail(context, workout),
                    );
                  },
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  void _openDetail(BuildContext context, CompletedWorkoutRow workout) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ActivityDetailScreen(workout: workout),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sport filter bar
// ---------------------------------------------------------------------------

class _SportFilterBar extends ConsumerWidget {
  const _SportFilterBar({required this.selected});
  final Sport? selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SizedBox(
      height: 40,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        itemCount: _sportTabs.length,
        itemBuilder: (context, i) {
          final tab = _sportTabs[i];
          final isSelected = tab.sport == selected;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilterChip(
              label: Text(tab.label),
              selected: isSelected,
              onSelected: (_) {
                ref.read(sportFilterProvider.notifier).state = tab.sport;
              },
            ),
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

class _EmptyFeed extends StatelessWidget {
  const _EmptyFeed();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.directions_run_outlined,
            size: 64,
            color: theme.colorScheme.outlineVariant,
          ),
          const SizedBox(height: 16),
          Text(
            'No activities yet',
            style: theme.textTheme.titleMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Tap + to log your first activity.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}
