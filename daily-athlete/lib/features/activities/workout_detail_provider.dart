import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../models/completed_workout.dart';
import '../auth/auth_notifier.dart';

/// Fetches a single workout by ID for the authenticated athlete.
/// Returns null when the row doesn't exist or has been soft-deleted.
final workoutDetailProvider =
    FutureProvider.autoDispose.family<CompletedWorkoutRow?, String>(
  (ref, workoutId) async {
    final authAsync = await ref.watch(authNotifierProvider.future);
    if (!authAsync.isAuthenticated || authAsync.userId == null) return null;

    final supabase = Supabase.instance.client;
    final data = await supabase
        .from('completed_workouts')
        .select()
        .eq('id', workoutId)
        .eq('athlete_id', authAsync.userId!)
        .isFilter('deleted_at', null)
        .isFilter('superseded_by_id', null)
        .maybeSingle();

    if (data == null) return null;
    return CompletedWorkoutRow.fromJson(data as Map<String, dynamic>);
  },
);
