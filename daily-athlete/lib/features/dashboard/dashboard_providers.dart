import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../features/auth/auth_notifier.dart';
import '../../models/coach_athlete_link.dart';
import '../../models/completed_workout.dart';
import '../../models/plan.dart';
import '../../models/planned_workout.dart';
import '../../models/sport.dart';
import '../../models/user.dart';

// ---------------------------------------------------------------------------
// Aggregation helpers — pure functions; tested directly in unit tests
// ---------------------------------------------------------------------------

/// Returns Monday of the ISO week containing [date] at midnight UTC.
DateTime weekStart(DateTime date) {
  final utc = date.toUtc();
  final weekday = utc.weekday; // Mon=1 … Sun=7
  return DateTime.utc(utc.year, utc.month, utc.day)
      .subtract(Duration(days: weekday - 1));
}

/// Returns Sunday 23:59:59.999 of the ISO week containing [date], UTC.
DateTime weekEnd(DateTime date) {
  return weekStart(date)
      .add(const Duration(days: 6, hours: 23, minutes: 59, seconds: 59, milliseconds: 999));
}

/// Sums duration_s across a list of [CompletedWorkoutRow].
int totalDurationS(List<CompletedWorkoutRow> workouts) {
  return workouts.fold(0, (sum, w) => sum + (w.durationS ?? 0));
}

/// Returns total hours (fractional) across [workouts].
double totalHours(List<CompletedWorkoutRow> workouts) {
  return totalDurationS(workouts) / 3600.0;
}

/// Returns distance-by-sport map (meters) for the given [workouts].
Map<Sport, double> distanceBySport(List<CompletedWorkoutRow> workouts) {
  final result = <Sport, double>{};
  for (final w in workouts) {
    if (w.distanceM != null && w.distanceM! > 0) {
      result[w.sport] = (result[w.sport] ?? 0) + w.distanceM!;
    }
  }
  return result;
}

/// Calculates consecutive-day streak going back from [today].
///
/// A day counts if at least one entry in [completedDates] falls on that
/// calendar date (compared in local time).  Returns 0 if today has no workout.
int calculateStreak(List<DateTime> completedDates, DateTime today) {
  if (completedDates.isEmpty) return 0;

  // Normalise to date-only local DateTime (midnight).
  DateTime toDate(DateTime dt) => DateTime(dt.year, dt.month, dt.day);

  final daySet = completedDates.map(toDate).toSet();

  int streak = 0;
  DateTime cursor = toDate(today);

  while (daySet.contains(cursor)) {
    streak++;
    cursor = cursor.subtract(const Duration(days: 1));
  }
  return streak;
}

/// Picks the next upcoming planned workout from [workouts]:
/// earliest scheduledDate >= [today] with status == [PlannedWorkoutStatus.planned].
PlannedWorkoutRow? nextUpcomingWorkout(
    List<PlannedWorkoutRow> workouts, DateTime today) {
  final todayDate = DateTime(today.year, today.month, today.day);
  final candidates = workouts.where((w) {
    final d = w.scheduledDate;
    final wd = DateTime(d.year, d.month, d.day);
    return w.status == PlannedWorkoutStatus.planned &&
        !wd.isBefore(todayDate) &&
        w.deletedAt == null;
  }).toList();

  if (candidates.isEmpty) return null;
  candidates.sort((a, b) => a.scheduledDate.compareTo(b.scheduledDate));
  return candidates.first;
}

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

class WeeklyStats {
  const WeeklyStats({
    required this.totalHours,
    required this.distanceBySport,
    required this.plannedCount,
    required this.completedCount,
  });

  final double totalHours;
  final Map<Sport, double> distanceBySport;
  final int plannedCount;
  final int completedCount;

  double get compliancePct =>
      plannedCount == 0 ? 0 : completedCount / plannedCount;
}

class AthleteDashboardData {
  const AthleteDashboardData({
    required this.activePlan,
    required this.weeklyStats,
    required this.nextWorkout,
    required this.streakDays,
    required this.weekPlanned,
    required this.weekCompleted,
  });

  final PlanRow? activePlan;
  final WeeklyStats weeklyStats;
  final PlannedWorkoutRow? nextWorkout;
  final int streakDays;
  final List<PlannedWorkoutRow> weekPlanned;
  final List<CompletedWorkoutRow> weekCompleted;
}

class AthleteRosterEntry {
  const AthleteRosterEntry({
    required this.athleteId,
    required this.displayName,
    required this.email,
    required this.weeklyStats,
    this.lastActivityDate,
  });

  final String athleteId;
  final String displayName;
  final String email;
  final WeeklyStats weeklyStats;
  final DateTime? lastActivityDate;

  String get name =>
      displayName.isNotEmpty ? displayName : email;
}

// ---------------------------------------------------------------------------
// AthleteDashboardNotifier
// ---------------------------------------------------------------------------

/// Fetches and aggregates all data for the athlete dashboard.
/// Uses .select() + date filters (not .stream()) for date-range queries, then
/// sets up a Realtime channel to re-fetch on table changes.
class AthleteDashboardNotifier
    extends AutoDisposeFamilyAsyncNotifier<AthleteDashboardData, String> {
  RealtimeChannel? _channel;

  @override
  Future<AthleteDashboardData> build(String athleteId) async {
    ref.onDispose(() {
      _channel?.unsubscribe();
      _channel = null;
    });

    _subscribeRealtime(athleteId);
    return _fetchAll(athleteId);
  }

  void _subscribeRealtime(String athleteId) {
    final supabase = Supabase.instance.client;

    _channel = supabase
        .channel('athlete-dashboard-$athleteId')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'completed_workouts',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'athlete_id',
            value: athleteId,
          ),
          callback: (_) => _refresh(athleteId),
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'planned_workouts',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'athlete_id',
            value: athleteId,
          ),
          callback: (_) => _refresh(athleteId),
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'plans',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'athlete_id',
            value: athleteId,
          ),
          callback: (_) => _refresh(athleteId),
        )
        .subscribe();
  }

  void _refresh(String athleteId) {
    if (state is! AsyncLoading) {
      ref.invalidateSelf();
    }
  }

  Future<AthleteDashboardData> _fetchAll(String athleteId) async {
    final supabase = Supabase.instance.client;
    final now = DateTime.now();
    final wStart = weekStart(now);
    final wEnd = weekEnd(now);

    final wStartStr = wStart.toIso8601String();
    final wEndStr = wEnd.toIso8601String();
    final todayStr = DateTime(now.year, now.month, now.day).toIso8601String().substring(0, 10);

    // Fetch active plan, this week's workouts, and upcoming planned workouts
    // in parallel. All use .select() with explicit filters (not .stream())
    // because we need date-range constraints.
    final results = await Future.wait([
      // [0] Active plan
      supabase
          .from('plans')
          .select()
          .eq('athlete_id', athleteId)
          .eq('status', 'active')
          .isFilter('deleted_at', null)
          .limit(1),
      // [1] This week's completed workouts
      supabase
          .from('completed_workouts')
          .select()
          .eq('athlete_id', athleteId)
          .isFilter('deleted_at', null)
          .gte('started_at', wStartStr)
          .lte('started_at', wEndStr),
      // [2] This week's planned workouts
      supabase
          .from('planned_workouts')
          .select()
          .eq('athlete_id', athleteId)
          .isFilter('deleted_at', null)
          .gte('scheduled_date', wStart.toIso8601String().substring(0, 10))
          .lte('scheduled_date', wEnd.toIso8601String().substring(0, 10)),
      // [3] Future planned workouts for "next workout" card
      supabase
          .from('planned_workouts')
          .select()
          .eq('athlete_id', athleteId)
          .eq('status', 'planned')
          .isFilter('deleted_at', null)
          .gte('scheduled_date', todayStr)
          .order('scheduled_date', ascending: true)
          .limit(10),
      // [4] Recent completed workouts for streak (last 365 days)
      supabase
          .from('completed_workouts')
          .select('started_at')
          .eq('athlete_id', athleteId)
          .isFilter('deleted_at', null)
          .gte('started_at',
              now.subtract(const Duration(days: 365)).toIso8601String()),
    ]);

    final planRows = (results[0] as List<dynamic>)
        .map((e) => PlanRow.fromJson(e as Map<String, dynamic>))
        .toList();

    final weekCompleted = (results[1] as List<dynamic>)
        .map((e) => CompletedWorkoutRow.fromJson(e as Map<String, dynamic>))
        .toList();

    final weekPlanned = (results[2] as List<dynamic>)
        .map((e) => PlannedWorkoutRow.fromJson(e as Map<String, dynamic>))
        .toList();

    final futurePlanned = (results[3] as List<dynamic>)
        .map((e) => PlannedWorkoutRow.fromJson(e as Map<String, dynamic>))
        .toList();

    final allDates = (results[4] as List<dynamic>).map((e) {
      final map = e as Map<String, dynamic>;
      return DateTime.parse(map['started_at'] as String);
    }).toList();

    final stats = WeeklyStats(
      totalHours: totalHours(weekCompleted),
      distanceBySport: distanceBySport(weekCompleted),
      plannedCount: weekPlanned.length,
      completedCount: weekCompleted.length,
    );

    return AthleteDashboardData(
      activePlan: planRows.isNotEmpty ? planRows.first : null,
      weeklyStats: stats,
      nextWorkout: nextUpcomingWorkout(futurePlanned, now),
      streakDays: calculateStreak(allDates, now),
      weekPlanned: weekPlanned,
      weekCompleted: weekCompleted,
    );
  }
}

/// Provider scoped to a specific athleteId so coaches can reuse it.
final athleteDashboardProvider = AsyncNotifierProvider.autoDispose
    .family<AthleteDashboardNotifier, AthleteDashboardData, String>(
  AthleteDashboardNotifier.new,
);

// ---------------------------------------------------------------------------
// Current-user athlete dashboard — convenience provider
// ---------------------------------------------------------------------------

/// Resolves the current user's id from auth then delegates to
/// [athleteDashboardProvider].
final myDashboardProvider =
    FutureProvider.autoDispose<AthleteDashboardData>((ref) async {
  final auth = await ref.watch(authNotifierProvider.future);
  final uid = auth.userId;
  if (uid == null) throw StateError('Not authenticated');
  return ref.watch(athleteDashboardProvider(uid).future);
});

// ---------------------------------------------------------------------------
// Coach roster provider
// ---------------------------------------------------------------------------

class CoachRosterNotifier
    extends AutoDisposeAsyncNotifier<List<AthleteRosterEntry>> {
  RealtimeChannel? _channel;

  @override
  Future<List<AthleteRosterEntry>> build() async {
    final auth = await ref.watch(authNotifierProvider.future);
    final coachId = auth.userId;
    if (coachId == null) throw StateError('Not authenticated');

    ref.onDispose(() {
      _channel?.unsubscribe();
      _channel = null;
    });

    _subscribeRealtime(coachId);
    return _fetchRoster(coachId);
  }

  void _subscribeRealtime(String coachId) {
    final supabase = Supabase.instance.client;
    _channel = supabase
        .channel('coach-roster-$coachId')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'coach_athlete_links',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'coach_user_id',
            value: coachId,
          ),
          callback: (_) {
            if (state is! AsyncLoading) ref.invalidateSelf();
          },
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'completed_workouts',
          callback: (_) {
            if (state is! AsyncLoading) ref.invalidateSelf();
          },
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'planned_workouts',
          callback: (_) {
            if (state is! AsyncLoading) ref.invalidateSelf();
          },
        )
        .subscribe();
  }

  Future<List<AthleteRosterEntry>> _fetchRoster(String coachId) async {
    final supabase = Supabase.instance.client;

    // 1. Fetch active links.
    final linksRaw = await supabase
        .from('coach_athlete_links')
        .select()
        .eq('coach_user_id', coachId)
        .eq('status', 'active')
        .isFilter('deleted_at', null);

    final links = (linksRaw as List<dynamic>)
        .map((e) => CoachAthleteLinkRow.fromJson(e as Map<String, dynamic>))
        .where((l) => l.isActive)
        .toList();

    if (links.isEmpty) return [];

    final athleteIds = links.map((l) => l.athleteUserId).toList();

    // 2. Fetch user profiles for all linked athletes.
    final usersRaw = await supabase
        .from('users')
        .select('id, email, display_name')
        .inFilter('id', athleteIds);

    final userMap = <String, UserRow>{};
    for (final u in usersRaw as List<dynamic>) {
      final row = UserRow.fromJson(u as Map<String, dynamic>);
      userMap[row.id] = row;
    }

    // 3. Batch-fetch this week's planned + completed for all athletes.
    final now = DateTime.now();
    final wStart = weekStart(now);
    final wEnd = weekEnd(now);

    final wStartDate = wStart.toIso8601String().substring(0, 10);
    final wEndDate = wEnd.toIso8601String().substring(0, 10);
    final wStartTs = wStart.toIso8601String();
    final wEndTs = wEnd.toIso8601String();

    final results = await Future.wait([
      supabase
          .from('planned_workouts')
          .select('athlete_id, id')
          .inFilter('athlete_id', athleteIds)
          .isFilter('deleted_at', null)
          .gte('scheduled_date', wStartDate)
          .lte('scheduled_date', wEndDate),
      supabase
          .from('completed_workouts')
          .select('athlete_id, started_at, duration_s, distance_m, sport')
          .inFilter('athlete_id', athleteIds)
          .isFilter('deleted_at', null)
          .gte('started_at', wStartTs)
          .lte('started_at', wEndTs),
      // Last activity per athlete (just dates) for "last active" label.
      supabase
          .from('completed_workouts')
          .select('athlete_id, started_at')
          .inFilter('athlete_id', athleteIds)
          .isFilter('deleted_at', null)
          .order('started_at', ascending: false)
          .limit(athleteIds.length * 5),
    ]);

    // Group planned counts by athlete.
    final plannedCounts = <String, int>{};
    for (final row in results[0] as List<dynamic>) {
      final id = (row as Map<String, dynamic>)['athlete_id'] as String;
      plannedCounts[id] = (plannedCounts[id] ?? 0) + 1;
    }

    // Group completed by athlete.
    final completedByAthlete = <String, List<CompletedWorkoutRow>>{};
    for (final row in results[1] as List<dynamic>) {
      final cw =
          CompletedWorkoutRow.fromJson(row as Map<String, dynamic>);
      completedByAthlete.putIfAbsent(cw.athleteId, () => []).add(cw);
    }

    // Most recent activity date per athlete.
    final lastActivity = <String, DateTime>{};
    for (final row in results[2] as List<dynamic>) {
      final map = row as Map<String, dynamic>;
      final id = map['athlete_id'] as String;
      if (!lastActivity.containsKey(id)) {
        lastActivity[id] =
            DateTime.parse(map['started_at'] as String);
      }
    }

    // Build roster entries.
    return athleteIds.map((id) {
      final user = userMap[id];
      final completed = completedByAthlete[id] ?? [];
      final stats = WeeklyStats(
        totalHours: totalHours(completed),
        distanceBySport: distanceBySport(completed),
        plannedCount: plannedCounts[id] ?? 0,
        completedCount: completed.length,
      );
      return AthleteRosterEntry(
        athleteId: id,
        displayName: user?.displayName ?? '',
        email: user?.email ?? '',
        weeklyStats: stats,
        lastActivityDate: lastActivity[id],
      );
    }).toList();
  }
}

final coachRosterProvider = AsyncNotifierProvider.autoDispose<
    CoachRosterNotifier, List<AthleteRosterEntry>>(
  CoachRosterNotifier.new,
);
