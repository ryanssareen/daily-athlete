import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';
import '../../models/completed_workout.dart';
import '../../models/sport.dart';
import 'workout_detail_provider.dart';

/// Mirrors ENRICHMENT_VERSION in apps/web/src/strava/build-summary-stats.ts.
/// Rows hydrated at an older version are re-hydrated once to pick up new
/// fields (splits, best efforts, gear, place).
const kEnrichmentVersion = 2;

/// True when a Strava workout is worth asking the server to enrich with HR
/// zones and laps: it hasn't been hydrated, and it's a sport Strava has zones
/// for. Mirrors the web detail page's `shouldHydrate` gates, including the
/// 10-minute negative cache after a failed attempt.
bool shouldHydrateWorkout(CompletedWorkoutRow workout, {DateTime? now}) {
  if (workout.source != CompletedWorkoutSource.strava) return false;
  if (workout.stravaActivityId == null) return false;
  if (workout.sport == Sport.strength || workout.sport == Sport.mobility) {
    return false;
  }
  final stats = workout.summaryStats;
  final version = stats['enrichment_v'];
  if (stats['hydrated_at'] != null &&
      version is num &&
      version >= kEnrichmentVersion) {
    return false;
  }
  final errAt = stats['hydrate_error_at'];
  if (errAt is String) {
    final parsed = DateTime.tryParse(errAt);
    final clock = now ?? DateTime.now();
    if (parsed != null && clock.difference(parsed) < const Duration(minutes: 10)) {
      return false;
    }
  }
  return true;
}

/// Asks the server to pull zones/laps from Strava for this workout, once per
/// detail-screen visit, then reloads the workout. Failure is silent: the
/// screen already renders everything it has without enrichment.
final workoutHydrationProvider =
    FutureProvider.autoDispose.family<void, String>((ref, workoutId) async {
  // read, not watch: invalidating the workout below must not re-run this
  // provider, or a hydration that Strava leaves un-stamped would loop.
  final workout = await ref.read(workoutDetailProvider(workoutId).future);
  if (workout == null || !shouldHydrateWorkout(workout)) return;

  final session = Supabase.instance.client.auth.currentSession;
  if (session == null) return;

  try {
    final response = await http
        .post(
          Uri.parse('${Env.apiBaseUrl}/api/integrations/strava/sync-workout'),
          headers: {
            'Authorization': 'Bearer ${session.accessToken}',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({'workoutId': workoutId}),
        )
        .timeout(const Duration(seconds: 20));
    if (response.statusCode == 200) {
      ref.invalidate(workoutDetailProvider(workoutId));
    }
  } catch (e) {
    debugPrint('workoutHydrationProvider($workoutId): $e');
  }
});
