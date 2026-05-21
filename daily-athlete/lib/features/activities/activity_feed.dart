import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/completed_workout.dart';
import '../activities/activities_providers.dart';
import '../activities/activity_row.dart';

/// Chronological activity feed (R4).
///
/// Owned by [ActivitiesTab]. Shows all activities for the target athlete
/// (self, or the coach-selected athlete) newest first. Tapping a row pushes
/// [ActivityDetailScreen].
class ActivityFeed extends ConsumerWidget {
  const ActivityFeed({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feedAsync = ref.watch(activityFeedProvider);

    return feedAsync.when(
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
          onRefresh: () => ref.refresh(activityFeedProvider.future),
          child: ListView.separated(
            padding: const EdgeInsets.only(bottom: 80),
            itemCount: rows.length,
            separatorBuilder: (_, _) => const Divider(height: 1),
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
    );
  }

  void _openDetail(BuildContext context, CompletedWorkoutRow workout) {
    context.push('/activities/${workout.id}?from=activities');
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
