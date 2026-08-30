// test/features/calendar/workout_action_sheet_test.dart
//
// Widget test for WorkoutActionSheet's "View details" action (U4). Pumps the
// sheet inside a minimal GoRouter with two routes -- a home route that opens
// the sheet, and a stand-in detail route at Routes.plannedWorkoutDetail's
// path -- and confirms tapping "View details" pops the sheet and navigates
// to the correct workout's detail route.
//
// The Complete/Skip/Reschedule actions are unchanged by U4 and already have
// no prior test coverage of their own network calls (they hit a real HTTP
// endpoint); this test is scoped to the one new action this unit adds.

import 'package:daily_athlete/features/calendar/workout_action_sheet.dart';
import 'package:daily_athlete/models/planned_workout.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:daily_athlete/router/routes.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

PlannedWorkoutRow _plannedRow() {
  return PlannedWorkoutRow.fromJson({
    'id': 'workout-42',
    'athlete_id': 'athlete-1',
    'scheduled_date': '2026-08-30',
    'sport': Sport.run.name,
    'structure': <String, dynamic>{},
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

Widget _app(PlannedWorkoutRow row) {
  final router = GoRouter(
    initialLocation: '/home',
    routes: [
      GoRoute(
        path: '/home',
        builder: (context, state) => Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                builder: (_) => WorkoutActionSheet(workout: row),
              ),
              child: const Text('open sheet'),
            ),
          ),
        ),
      ),
      GoRoute(
        path: Routes.plannedWorkoutDetail,
        builder: (context, state) => Scaffold(
          body: Text('detail screen for ${state.pathParameters['id']}'),
        ),
      ),
    ],
  );

  return MaterialApp.router(routerConfig: router);
}

void main() {
  testWidgets(
      "tapping View details pops the sheet and navigates to the workout's detail route",
      (tester) async {
    final row = _plannedRow();
    await tester.pumpWidget(_app(row));
    await tester.pumpAndSettle();

    await tester.tap(find.text('open sheet'));
    await tester.pumpAndSettle();
    expect(find.text('View details'), findsOneWidget);

    await tester.tap(find.text('View details'));
    await tester.pumpAndSettle();

    expect(find.text('detail screen for workout-42'), findsOneWidget);
    expect(find.byType(WorkoutActionSheet), findsNothing);
  });
}
