import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/shell/role_notifier.dart';
import '../../models/user.dart';
import 'athlete_dashboard.dart';
import 'coach_dashboard.dart';

/// Entry point for the /dashboard route.
///
/// When [athleteId] is provided (coach drilling into an athlete detail screen),
/// renders [AthleteDashboard] for that specific athlete, bypassing role detection.
/// Otherwise, detects the current user's role and renders the appropriate dashboard.
class DashboardTab extends ConsumerWidget {
  const DashboardTab({super.key, this.athleteId});

  /// Non-null when a coach navigates to /dashboard/athlete/:id.
  final String? athleteId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Coach viewing a specific athlete — skip role check.
    if (athleteId != null) {
      return AthleteDashboard(athleteId: athleteId!);
    }

    final roleAsync = ref.watch(roleNotifierProvider);

    return roleAsync.when(
      loading: () => const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      ),
      error: (err, stack) => Scaffold(
        body: Center(
          child: _RoleErrorView(
            error: err.toString(),
            onRetry: () => ref.invalidate(roleNotifierProvider),
          ),
        ),
      ),
      data: (role) {
        return switch (role) {
          RoleFlag.coach => const CoachDashboard(),
          RoleFlag.athlete => const AthleteDashboard(),
        };
      },
    );
  }
}

class _RoleErrorView extends StatelessWidget {
  const _RoleErrorView({required this.error, required this.onRetry});

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
          Text(
            'Could not load dashboard',
            style: theme.textTheme.titleMedium,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            error,
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
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
