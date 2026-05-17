import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../models/completed_workout.dart';
import '../../models/sport.dart';
import '../auth/auth_notifier.dart';

// ---------------------------------------------------------------------------
// selectedAthleteIdProvider
//
// Coach mode: set this to view another athlete's feed.
// Athlete mode: stays null — the server query uses the authenticated user's id.
// ---------------------------------------------------------------------------

final selectedAthleteIdProvider = StateProvider<String?>((ref) => null);

// ---------------------------------------------------------------------------
// activityFeedProvider
//
// Fetches all completed_workouts for the target athlete (self or coach-selected
// athlete), ordered newest first. Returns an empty list when no rows exist.
// ---------------------------------------------------------------------------

final activityFeedProvider =
    FutureProvider<List<CompletedWorkoutRow>>((ref) async {
  final authAsync = await ref.watch(authNotifierProvider.future);
  if (!authAsync.isAuthenticated) return [];

  final targetId =
      ref.watch(selectedAthleteIdProvider) ?? authAsync.userId;
  if (targetId == null) return [];

  final supabase = Supabase.instance.client;
  final data = await supabase
      .from('completed_workouts')
      .select()
      .eq('athlete_id', targetId)
      .isFilter('deleted_at', null)
      .order('started_at', ascending: false);

  return (data as List<dynamic>)
      .map((row) => CompletedWorkoutRow.fromJson(row as Map<String, dynamic>))
      .toList();
});

// ---------------------------------------------------------------------------
// sportFilterProvider
//
// Client-side sport filter for the feed. null = show all.
// ---------------------------------------------------------------------------

final sportFilterProvider = StateProvider<Sport?>((ref) => null);

// ---------------------------------------------------------------------------
// filteredFeedProvider
//
// Applies sportFilterProvider on top of activityFeedProvider in memory.
// ---------------------------------------------------------------------------

final filteredFeedProvider =
    Provider<AsyncValue<List<CompletedWorkoutRow>>>((ref) {
  final feedAsync = ref.watch(activityFeedProvider);
  final sport = ref.watch(sportFilterProvider);

  return feedAsync.whenData((rows) {
    if (sport == null) return rows;
    return rows.where((r) => r.sport == sport).toList();
  });
});
