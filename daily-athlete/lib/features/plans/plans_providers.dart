// lib/features/plans/plans_providers.dart
//
// Riverpod providers for the plan history screens. Network calls live in
// plans_api.dart — this file only wires it up, same convention as
// ../reports/reports_providers.dart.

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/plan.dart';
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
