// lib/features/calendar/calendar_providers.dart
//
// Riverpod providers for the Calendar tab.
//
// Key design constraints (from plan):
// - supabase-dart .stream() only supports .eq() filters. Date-range queries
//   MUST use .select().gte().lte() and subscribe to a Realtime channel for
//   push-triggered re-fetch. Never use .stream() for date ranges.
// - Year view data is fetched once per session (not realtime) — full-year
//   streaming is excessive.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../models/activity_summary.dart';
import '../../models/completed_workout.dart';
import '../../models/planned_workout.dart';
import '../../models/workout_match.dart';
import '../auth/auth_notifier.dart';

// ---------------------------------------------------------------------------
// calendarAthleteIdProvider
//
// Coach mode: set this to view a specific athlete's calendar.
// Athlete mode: stays null — the server query uses the authenticated user's id.
// ---------------------------------------------------------------------------

final calendarAthleteIdProvider = StateProvider<String?>((ref) => null);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Map key for a calendar date that is already a day, not an instant: planned
/// `scheduled_date` (local midnight), the selected day (UTC-labelled) and the
/// range ends. Reads the fields as they are -- never converts zones, or a
/// UTC-labelled date shifts a day west of UTC.
DateTime calendarDayKey(DateTime date) =>
    DateTime.utc(date.year, date.month, date.day);

/// Map key for the athlete's LOCAL day of an instant. `started_at` arrives as
/// a UTC instant, so the `toLocal()` keeps a 05:00 IST workout on its own day
/// instead of the previous UTC day.
DateTime instantDayKey(DateTime instant) => calendarDayKey(instant.toLocal());

/// The `started_at` window covering the local days [start]..[end] (UTC-labelled
/// calendar dates): local midnight of [start] up to, not including, local
/// midnight after [end]. Use `gte(from)` and `lt(to)`.
({String from, String to}) startedAtWindow(DateTime start, DateTime end) => (
      from: DateTime(start.year, start.month, start.day).toUtc().toIso8601String(),
      to: DateTime(end.year, end.month, end.day + 1).toUtc().toIso8601String(),
    );

/// Merge planned + completed workout lists into a date-keyed map.
///
/// A planned row with a live [WorkoutMatchRow] (deletedAt == null) linking it
/// to one of the completed rows becomes a single [ActivitySummary] carrying
/// both — that completed row is not also emitted on its own. Unmatched rows
/// (planned-only or completed-only) each get their own entry, same as before.
///
/// Exposed publicly (not prefixed with `_`) so unit tests can call it
/// directly without needing a live Supabase connection.
Map<DateTime, List<ActivitySummary>> mergeForTest(
  List<PlannedWorkoutRow> planned,
  List<CompletedWorkoutRow> completed,
  List<WorkoutMatchRow> matches,
) => _mergeIntoWeekMap(planned, completed, matches);

Map<DateTime, List<ActivitySummary>> _mergeIntoWeekMap(
  List<PlannedWorkoutRow> planned,
  List<CompletedWorkoutRow> completed,
  List<WorkoutMatchRow> matches,
) {
  final result = <DateTime, List<ActivitySummary>>{};

  final completedById = {for (final cw in completed) cw.id: cw};
  final completedIdByPlannedId = {
    for (final m in matches)
      if (m.deletedAt == null) m.plannedWorkoutId: m.completedWorkoutId,
  };
  final matchedCompletedIds = completedIdByPlannedId.values.toSet();

  for (final pw in planned) {
    final matchedCompleted = completedById[completedIdByPlannedId[pw.id]];
    final key = calendarDayKey(pw.scheduledDate);
    result.putIfAbsent(key, () => []).add(
          ActivitySummary(
            date: pw.scheduledDate,
            sport: pw.sport,
            planned: pw,
            completed: matchedCompleted,
          ),
        );
  }

  for (final cw in completed) {
    if (matchedCompletedIds.contains(cw.id)) continue; // rendered via its matched planned entry instead
    final key = instantDayKey(cw.startedAt);
    result.putIfAbsent(key, () => []).add(
          ActivitySummary(
              date: cw.startedAt, sport: cw.sport, completed: cw),
        );
  }

  return result;
}

// ---------------------------------------------------------------------------
// calendarWeekRangeProvider
//
// The ISO week [start, end] currently visible in Day/Week/Month views.
// Changing this causes calendarWeekDataProvider to refetch.
// ---------------------------------------------------------------------------

final calendarWeekRangeProvider =
    StateProvider<({DateTime start, DateTime end})>((ref) {
  // Default: current ISO week (Mon–Sun).
  final now = DateTime.now();
  final weekday = now.weekday; // 1=Mon … 7=Sun
  final start = DateTime.utc(now.year, now.month, now.day - (weekday - 1));
  final end = DateTime.utc(now.year, now.month, now.day - (weekday - 1) + 6);
  return (start: start, end: end);
});

// ---------------------------------------------------------------------------
// calendarWeekDataProvider
//
// Fetches planned + completed workouts for the visible date range and merges
// them into Map<DateTime, List<ActivitySummary>>.
//
// Realtime: subscribes to a Supabase Realtime channel on planned_workouts
// and completed_workouts tables; on any table-change event, re-fetches
// via .select().gte().lte() (NOT .stream()).
// ---------------------------------------------------------------------------

class CalendarWeekNotifier
    extends AutoDisposeAsyncNotifier<Map<DateTime, List<ActivitySummary>>> {
  RealtimeChannel? _channel;

  @override
  Future<Map<DateTime, List<ActivitySummary>>> build() async {
    final authState = await ref.watch(authNotifierProvider.future);
    if (!authState.isAuthenticated) return {};

    final range = ref.watch(calendarWeekRangeProvider);
    final targetId =
        ref.watch(calendarAthleteIdProvider) ?? authState.userId;
    if (targetId == null) return {};

    // Subscribe to realtime changes and re-fetch on each event.
    _subscribeRealtime(targetId, range);

    ref.onDispose(() {
      _channel?.unsubscribe();
    });

    return _fetchWeekData(targetId, range);
  }

  void _subscribeRealtime(
      String athleteId, ({DateTime start, DateTime end}) range) {
    final supabase = Supabase.instance.client;
    _channel?.unsubscribe();
    _channel = supabase
        .channel('calendar_week_$athleteId')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'planned_workouts',
          callback: (_) => _refetch(athleteId, range),
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'completed_workouts',
          callback: (_) => _refetch(athleteId, range),
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'workout_matches',
          callback: (_) => _refetch(athleteId, range),
        )
        .subscribe();
  }

  void _refetch(
      String athleteId, ({DateTime start, DateTime end}) range) {
    state = const AsyncLoading();
    _fetchWeekData(athleteId, range).then((data) {
      state = AsyncData(data);
    }).catchError((Object err, StackTrace st) {
      state = AsyncError(err, st);
    });
  }

  Future<Map<DateTime, List<ActivitySummary>>> _fetchWeekData(
    String athleteId,
    ({DateTime start, DateTime end}) range,
  ) async {
    final supabase = Supabase.instance.client;
    final startStr =
        range.start.toIso8601String().substring(0, 10); // 'YYYY-MM-DD'
    final endStr = range.end.toIso8601String().substring(0, 10);
    final window = startedAtWindow(range.start, range.end);

    final plannedRaw = await supabase
        .from('planned_workouts')
        .select()
        .eq('athlete_id', athleteId)
        .gte('scheduled_date', startStr)
        .lte('scheduled_date', endStr)
        .isFilter('deleted_at', null);

    final completedRaw = await supabase
        .from('completed_workouts')
        .select()
        .eq('athlete_id', athleteId)
        .gte('started_at', window.from)
        .lt('started_at', window.to)
        .isFilter('deleted_at', null);

    final planned = (plannedRaw as List<dynamic>)
        .map((r) =>
            PlannedWorkoutRow.fromJson(r as Map<String, dynamic>))
        .toList();
    final completed = (completedRaw as List<dynamic>)
        .map((r) =>
            CompletedWorkoutRow.fromJson(r as Map<String, dynamic>))
        .toList();

    final matches = planned.isEmpty
        ? <WorkoutMatchRow>[]
        : (await supabase
                .from('workout_matches')
                .select()
                .inFilter('planned_workout_id', planned.map((p) => p.id).toList())
                .isFilter('deleted_at', null) as List<dynamic>)
            .map((r) => WorkoutMatchRow.fromJson(r as Map<String, dynamic>))
            .toList();

    return _mergeIntoWeekMap(planned, completed, matches);
  }
}

final calendarWeekDataProvider = AsyncNotifierProvider.autoDispose<
    CalendarWeekNotifier, Map<DateTime, List<ActivitySummary>>>(
  CalendarWeekNotifier.new,
);

// ---------------------------------------------------------------------------
// yearHeatmapProvider
//
// Fetches all completed_workouts for the past 12 months and aggregates them
// into Map<DateTime, int> (date → total duration_s). Fetched once per
// session on tab open — NOT a realtime stream.
// ---------------------------------------------------------------------------

/// Aggregate a list of [CompletedWorkoutRow] into a date-keyed duration map.
/// Exposed as a top-level function for testability.
Map<DateTime, int> aggregateYearHeatmap(
    List<CompletedWorkoutRow> workouts) {
  final result = <DateTime, int>{};
  for (final cw in workouts) {
    final key = instantDayKey(cw.startedAt);
    result[key] = (result[key] ?? 0) + (cw.durationS ?? 0);
  }
  return result;
}

final yearHeatmapProvider =
    FutureProvider.autoDispose<Map<DateTime, int>>((ref) async {
  final authState = await ref.watch(authNotifierProvider.future);
  if (!authState.isAuthenticated) return {};

  final targetId =
      ref.watch(calendarAthleteIdProvider) ?? authState.userId;
  if (targetId == null) return {};

  final supabase = Supabase.instance.client;
  final oneYearAgo = DateTime.now().subtract(const Duration(days: 365));
  final cutoff = DateTime(oneYearAgo.year, oneYearAgo.month, oneYearAgo.day)
      .toUtc()
      .toIso8601String();

  final raw = await supabase
      .from('completed_workouts')
      .select('started_at, duration_s, sport')
      .eq('athlete_id', targetId)
      .gte('started_at', cutoff)
      .isFilter('deleted_at', null);

  final workouts = (raw as List<dynamic>)
      .map((r) =>
          CompletedWorkoutRow.fromJson(r as Map<String, dynamic>))
      .toList();

  return aggregateYearHeatmap(workouts);
});

// ---------------------------------------------------------------------------
// selectedDateProvider
//
// Currently selected date in Day view and for coach assignment.
// ---------------------------------------------------------------------------

final selectedDateProvider = StateProvider<DateTime>((ref) {
  final now = DateTime.now();
  return calendarDayKey(now);
});

// ---------------------------------------------------------------------------
// dayWorkoutsProvider
//
// Filters calendarWeekDataProvider for the selected day.
// Re-uses the week fetch — no extra network call.
// ---------------------------------------------------------------------------

final dayWorkoutsProvider =
    Provider.autoDispose<AsyncValue<List<ActivitySummary>>>((ref) {
  final weekAsync = ref.watch(calendarWeekDataProvider);
  final selectedDate = ref.watch(selectedDateProvider);
  final key = calendarDayKey(selectedDate);

  return weekAsync.whenData(
    (map) => map[key] ?? [],
  );
});
