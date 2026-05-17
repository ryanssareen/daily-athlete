import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/user.dart';
import '../activities/activity_feed.dart';
import '../activities/manual_log_sheet.dart';
import '../activities/activities_providers.dart';
import '../shared/athlete_selector.dart';
import '../shell/role_notifier.dart';

/// Activities tab — the entry point for Unit 7 (R4–R9).
///
/// - [activityId]: deep-link into a specific activity (reserved for router).
/// - [athleteId]: coach mode — pre-selects a specific athlete's feed.
class ActivitiesTab extends ConsumerWidget {
  const ActivitiesTab({super.key, this.activityId, this.athleteId});

  final String? activityId;
  final String? athleteId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // If athleteId is provided by the router (coach tapped athlete card),
    // sync it into the provider once on first build.
    _syncAthleteId(ref);

    final roleAsync = ref.watch(roleNotifierProvider);
    final isCoach = roleAsync.valueOrNull == RoleFlag.coach;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Activities'),
        bottom: isCoach
            ? PreferredSize(
                preferredSize: const Size.fromHeight(48),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  child: Row(
                    children: [
                      const Text('Athlete: '),
                      const AthleteSelectorDropdown(),
                    ],
                  ),
                ),
              )
            : null,
      ),
      body: const ActivityFeed(),
      floatingActionButton: FloatingActionButton(
        onPressed: () => showManualLogSheet(context),
        tooltip: 'Log activity',
        child: const Icon(Icons.add),
      ),
    );
  }

  /// Syncs the [athleteId] route parameter into [selectedAthleteIdProvider]
  /// if it differs from the current value. Safe to call on every build
  /// because it only writes when the value changes.
  void _syncAthleteId(WidgetRef ref) {
    if (athleteId == null) return;
    final current = ref.read(selectedAthleteIdProvider);
    if (current != athleteId) {
      // Schedule after build to avoid writing state during build.
      Future.microtask(() {
        ref.read(selectedAthleteIdProvider.notifier).state = athleteId;
      });
    }
  }
}
