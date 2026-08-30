import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../models/planned_workout.dart';
import '../auth/auth_notifier.dart';

/// Fetches a single planned workout by ID for the authenticated athlete.
/// Returns null when the row doesn't exist, has been soft-deleted, or
/// belongs to another athlete.
final plannedWorkoutDetailProvider =
    FutureProvider.autoDispose.family<PlannedWorkoutRow?, String>(
  (ref, workoutId) async {
    final authAsync = await ref.watch(authNotifierProvider.future);
    if (!authAsync.isAuthenticated || authAsync.userId == null) return null;

    final supabase = Supabase.instance.client;
    final data = await supabase
        .from('planned_workouts')
        .select(
          'id, athlete_id, scheduled_date, sport, structure, status, '
          'plan_id, planned_load, rationale, edited_by_kind, '
          'edited_by_user_id, edited_at, created_at, deleted_at',
        )
        .eq('id', workoutId)
        .eq('athlete_id', authAsync.userId!)
        .isFilter('deleted_at', null)
        .maybeSingle();

    if (data == null) return null;
    return PlannedWorkoutRow.fromJson(data);
  },
);
