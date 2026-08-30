// test/features/calendar/day_view_test.dart
//
// Widget tests for _PlannedDetails' rendering behavior, exercised through
// the public DayView (per the year_heatmap_view_test.dart precedent of
// testing a file-private widget through its public ConsumerWidget parent,
// since Dart privacy is per-library/file and this test lives in a
// different file than day_view.dart).
//
// dayWorkoutsProvider is overridden directly with AsyncData([...]) so no
// live Supabase call / realtime subscription is exercised -- it's a plain
// Provider.autoDispose derived from calendarWeekDataProvider, so overriding
// it bypasses that whole fetch chain. unitsStorageProvider is overridden
// with an in-memory fake (same pattern as
// test/features/settings/units_notifier_test.dart) so UnitsNotifier
// resolves to the 'km' default without touching the OS keychain.
//
// Scenarios:
// - description/distance_m items still render unchanged (baseline,
//   protects what KTD3's swap doesn't touch).
// - est_duration_min-only structure now shows a duration line (previously
//   silently dropped).
// - total_duration_min-only structure similarly shows a duration line.
// - duration_s still works (regression baseline for the already-working case).

import 'package:daily_athlete/features/calendar/calendar_providers.dart';
import 'package:daily_athlete/features/calendar/day_view.dart';
import 'package:daily_athlete/features/settings/units_notifier.dart';
import 'package:daily_athlete/models/activity_summary.dart';
import 'package:daily_athlete/models/planned_workout.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

// ---------------------------------------------------------------------------
// Minimal in-memory FlutterSecureStorage fake (empty -> UnitsNotifier
// defaults to km/m/kg).
// ---------------------------------------------------------------------------

class _FakeStorage extends FlutterSecureStorage {
  @override
  Future<String?> read({
    required String key,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async =>
      null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

PlannedWorkoutRow _plannedRow(Map<String, dynamic> structure) {
  return PlannedWorkoutRow.fromJson({
    'id': 'workout-1',
    'athlete_id': 'athlete-1',
    'scheduled_date': '2026-08-30',
    'sport': Sport.run.name,
    'structure': structure,
    'status': 'planned',
    'plan_id': null,
    'planned_load': null,
    'rationale': null,
    'edited_by_kind': null,
    'edited_by_user_id': null,
    'edited_at': null,
    'created_at': null,
    'deleted_at': null,
  });
}

Widget _app(Map<String, dynamic> structure) {
  final row = _plannedRow(structure);
  final summary = ActivitySummary(date: row.scheduledDate, sport: row.sport, planned: row);

  return ProviderScope(
    overrides: [
      dayWorkoutsProvider.overrideWithValue(AsyncData([summary])),
      unitsStorageProvider.overrideWithValue(_FakeStorage()),
    ],
    child: MaterialApp(
      home: Scaffold(body: DayView(date: DateTime.utc(2026, 8, 30))),
    ),
  );
}

void main() {
  testWidgets('renders description and distance_m unchanged (baseline)',
      (tester) async {
    await tester.pumpWidget(_app({
      'description': 'Easy aerobic spin',
      'distance_m': 5000,
    }));
    await tester.pumpAndSettle();

    expect(find.text('Easy aerobic spin'), findsOneWidget);
    expect(find.text('Distance: 5.0 km'), findsOneWidget);
  });

  testWidgets('shows a duration line for est_duration_min (previously dropped)',
      (tester) async {
    await tester.pumpWidget(_app({'est_duration_min': 45}));
    await tester.pumpAndSettle();

    expect(find.text('Target: 45m'), findsOneWidget);
  });

  testWidgets('shows a duration line for total_duration_min (previously dropped)',
      (tester) async {
    await tester.pumpWidget(_app({'total_duration_min': 90}));
    await tester.pumpAndSettle();

    expect(find.text('Target: 1h 30m'), findsOneWidget);
  });

  testWidgets('still shows a duration line for duration_s (regression baseline)',
      (tester) async {
    await tester.pumpWidget(_app({'duration_s': 1800}));
    await tester.pumpAndSettle();

    expect(find.text('Target: 30m'), findsOneWidget);
  });
}
