// lib/features/plans/plans_providers.dart
//
// Riverpod providers for the plan history screens. Network calls live in
// plans_api.dart — this file only wires it up, same convention as
// ../reports/reports_providers.dart.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../models/plan.dart';
import '../../models/planned_workout.dart';
import '../auth/auth_notifier.dart';
import 'plans_api.dart';

/// GET /api/plans — the plan history list screen.
final planHistoryProvider = FutureProvider.autoDispose<List<PlanRow>>((ref) async {
  return fetchPlanList();
});

/// GET /api/plans/:id — a single plan's detail screen.
final planDetailProvider =
    FutureProvider.autoDispose.family<PlanRow, String>((ref, id) async {
  return fetchPlan(id);
});

/// Every live planned workout belonging to a plan, soonest first.
final planWorkoutsProvider =
    FutureProvider.autoDispose.family<List<PlannedWorkoutRow>, String>((ref, planId) async {
  final auth = await ref.watch(authNotifierProvider.future);
  if (!auth.isAuthenticated || auth.userId == null) return const [];

  final data = await Supabase.instance.client
      .from('planned_workouts')
      .select()
      .eq('athlete_id', auth.userId!)
      .eq('plan_id', planId)
      .isFilter('deleted_at', null)
      .order('scheduled_date');
  return data.map(PlannedWorkoutRow.fromJson).toList();
});
