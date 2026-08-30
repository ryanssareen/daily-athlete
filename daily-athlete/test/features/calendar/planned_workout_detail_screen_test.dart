// test/features/calendar/planned_workout_detail_screen_test.dart
//
// Widget test for PlannedWorkoutDetailScreen's four AsyncValue states
// (loading / error / data: null / data: <row>), using ProviderScope
// overrides on plannedWorkoutDetailProvider directly -- no live Supabase
// call, and no need to also stand up authNotifierProvider since overriding
// the family provider itself replaces its whole body (including its
// internal auth read).
//
// This is the "bonus" scenario from the U3 test list. The repo has no
// existing precedent for widget-testing a ConsumerWidget driven by a live-
// network provider, but overriding the top-level FutureProvider directly
// keeps this simple enough to be worth adding.

import 'dart:async';

import 'package:daily_athlete/features/calendar/planned_workout_detail_provider.dart';
import 'package:daily_athlete/features/calendar/planned_workout_detail_screen.dart';
import 'package:daily_athlete/models/planned_workout.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const _workoutId = 'workout-1';

PlannedWorkoutRow _row({Map<String, dynamic>? structure, String? rationale}) {
  return PlannedWorkoutRow.fromJson({
    'id': _workoutId,
    'athlete_id': 'user-1',
    'scheduled_date': '2026-08-30',
    'sport': Sport.run.name,
    'structure': structure ?? <String, dynamic>{},
    'status': 'planned',
    'plan_id': null,
    'planned_load': null,
    'rationale': rationale,
    'edited_by_kind': null,
    'edited_by_user_id': null,
    'edited_at': null,
    'created_at': null,
    'deleted_at': null,
  });
}

Widget _app(List<Override> overrides) {
  return ProviderScope(
    overrides: overrides,
    child: const MaterialApp(
      home: PlannedWorkoutDetailScreen(workoutId: _workoutId),
    ),
  );
}

void main() {
  testWidgets('loading state shows a spinner', (tester) async {
    final completer = Completer<PlannedWorkoutRow?>();
    await tester.pumpWidget(_app([
      plannedWorkoutDetailProvider(_workoutId).overrideWith((ref) => completer.future),
    ]));
    await tester.pump();

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('error state shows a message and a retry button', (tester) async {
    await tester.pumpWidget(_app([
      plannedWorkoutDetailProvider(_workoutId).overrideWith(
        (ref) => Future<PlannedWorkoutRow?>.error(Exception('network down')),
      ),
    ]));
    await tester.pump();

    expect(find.text('Could not load this workout'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Retry'), findsOneWidget);
  });

  testWidgets('data: null shows "Workout not found" with a way back', (tester) async {
    await tester.pumpWidget(_app([
      plannedWorkoutDetailProvider(_workoutId).overrideWith((ref) async => null),
    ]));
    await tester.pump();

    expect(find.text('Workout not found'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Back to calendar'), findsOneWidget);
  });

  testWidgets('data: <row> renders the view-model output as plain text', (tester) async {
    const scriptLike = '<script>alert("xss")</script>';
    await tester.pumpWidget(_app([
      plannedWorkoutDetailProvider(_workoutId).overrideWith(
        (ref) async => _row(
          structure: {'duration_s': 3600, 'description': scriptLike},
          rationale: 'Building aerobic base.',
        ),
      ),
    ]));
    await tester.pump();

    expect(find.text('1h 0m'), findsOneWidget);
    expect(find.text('Building aerobic base.'), findsOneWidget);
    // Rendered via a literal Text widget, not interpreted/stripped (R7).
    expect(find.text(scriptLike), findsOneWidget);
  });
}
