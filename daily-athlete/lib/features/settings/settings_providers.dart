// Settings providers barrel — re-exports the providers used by settings widgets.
//
// Import this file from any settings widget instead of importing each
// notifier individually.

export 'theme_notifier.dart' show themeNotifierProvider, ThemeNotifier;
export 'units_notifier.dart'
    show unitsNotifierProvider, UnitsNotifier, UnitsPrefs;
export 'strava_oauth_service.dart'
    show
        stravaOAuthServiceProvider,
        StravaOAuthService,
        StravaOAuthState,
        StravaConnectionStatus;

// Supabase providers for coach/athlete link queries used by settings sections.
// These are thin query providers wrapping direct supabase-dart calls;
// no caching or realtime — settings data is fetched on focus only.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../features/auth/auth_notifier.dart';

// ---------------------------------------------------------------------------
// Athlete — linked coach info (R20)
// ---------------------------------------------------------------------------

/// Returns the active coach link for the authenticated athlete, or null if
/// no coach is linked. Includes the coach's display_name via a join.
final athleteCoachLinkProvider =
    FutureProvider.autoDispose<_CoachInfo?>((ref) async {
  final authState = await ref.watch(authNotifierProvider.future);
  if (!authState.isAuthenticated) return null;

  final userId = authState.userId;
  if (userId == null) return null;

  final supabase = Supabase.instance.client;

  // Query coach_athlete_links + join users for display_name.
  final rows = await supabase
      .from('coach_athlete_links')
      .select('id, coach_user_id, users!coach_user_id(display_name, email)')
      .eq('athlete_user_id', userId)
      .eq('status', 'active')
      .isFilter('deleted_at', null)
      .limit(1);

  if (rows.isEmpty) return null;
  final row = rows.first;
  final coach = row['users'] as Map<String, dynamic>?;
  return _CoachInfo(
    linkId: row['id'] as String,
    coachUserId: row['coach_user_id'] as String,
    displayName: coach?['display_name'] as String? ??
        coach?['email'] as String? ??
        'Your Coach',
  );
});

class _CoachInfo {
  const _CoachInfo({
    required this.linkId,
    required this.coachUserId,
    required this.displayName,
  });
  final String linkId;
  final String coachUserId;
  final String displayName;
}

// Re-export so widgets can import from this barrel.
typedef CoachInfo = _CoachInfo;

// ---------------------------------------------------------------------------
// Coach — linked athletes list (R21)
// ---------------------------------------------------------------------------

/// Returns the list of active athlete links for the authenticated coach,
/// including each athlete's display_name via a join.
final coachAthletesProvider =
    FutureProvider.autoDispose<List<_AthleteInfo>>((ref) async {
  final authState = await ref.watch(authNotifierProvider.future);
  if (!authState.isAuthenticated) return [];

  final userId = authState.userId;
  if (userId == null) return [];

  final supabase = Supabase.instance.client;

  final rows = await supabase
      .from('coach_athlete_links')
      .select('id, athlete_user_id, users!athlete_user_id(display_name, email)')
      .eq('coach_user_id', userId)
      .eq('status', 'active')
      .isFilter('deleted_at', null);

  return (rows as List<dynamic>).map((r) {
    final row = r as Map<String, dynamic>;
    final athlete = row['users'] as Map<String, dynamic>?;
    return _AthleteInfo(
      linkId: row['id'] as String,
      athleteUserId: row['athlete_user_id'] as String,
      displayName: athlete?['display_name'] as String? ??
          athlete?['email'] as String? ??
          'Athlete',
    );
  }).toList();
});

class _AthleteInfo {
  const _AthleteInfo({
    required this.linkId,
    required this.athleteUserId,
    required this.displayName,
  });
  final String linkId;
  final String athleteUserId;
  final String displayName;
}

// Re-export type alias for widget use.
typedef AthleteInfo = _AthleteInfo;
