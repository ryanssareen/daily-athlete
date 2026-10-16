import 'dart:convert';
import 'dart:io';

import 'package:daily_athlete/features/plans/plan_forecast_card.dart';
import 'package:daily_athlete/features/plans/plan_outline.dart';
import 'package:daily_athlete/features/plans/plan_story_card.dart';
import 'package:daily_athlete/models/plan_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

PlanView _view({Map<String, dynamic> Function(Map<String, dynamic>)? tweak}) {
  final raw = File('../packages/shared/test-fixtures/plan-view-sample.json').readAsStringSync();
  var json = jsonDecode(raw) as Map<String, dynamic>;
  if (tweak != null) json = tweak(json);
  return PlanView.fromJson(json);
}

Widget _wrap(Widget child) => MaterialApp(
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

void main() {
  testWidgets('story card shows paragraphs and the quoted why line', (tester) async {
    await tester.pumpWidget(_wrap(PlanStoryCard(story: _view().story)));
    expect(find.textContaining('4-week block'), findsOneWidget);
    expect(find.textContaining('Easy aerobic running'), findsOneWidget);
  });

  testWidgets('outline expands only the current week and shows a verdict chip', (tester) async {
    await tester.pumpWidget(_wrap(PlanOutline(weeks: _view().weeks, verdictsUnavailable: false)));
    await tester.pumpAndSettle();
    expect(find.text('As prescribed'), findsOneWidget);
    expect(find.text('106%'), findsOneWidget);
    expect(find.text('1 skipped'), findsOneWidget);
    expect(find.text('Build'), findsOneWidget);
    expect(find.text('Planned load 42'), findsOneWidget);
    expect(find.text('Easy aerobic after Sunday\'s long run'), findsOneWidget);
    expect(find.text('No workouts scheduled yet'), findsNothing);
  });

  testWidgets('verdicts unavailable note', (tester) async {
    await tester.pumpWidget(_wrap(PlanOutline(weeks: _view().weeks, verdictsUnavailable: true)));
    await tester.pumpAndSettle();
    expect(find.text('Verdicts unavailable right now'), findsOneWidget);
  });

  testWidgets('outline with no weeks shows the empty state', (tester) async {
    await tester.pumpWidget(_wrap(const PlanOutline(weeks: [], verdictsUnavailable: false)));
    expect(find.text('No workouts scheduled yet'), findsOneWidget);
  });

  testWidgets('forecast ok shows figures and labels', (tester) async {
    await tester.pumpWidget(_wrap(PlanForecastCard(forecast: _view().forecast)));
    expect(find.text('Fresh and ready to perform'), findsWidgets);
    expect(find.text('End of block, Nov 8'), findsOneWidget);
    expect(find.text('On Nov 9'), findsOneWidget);
    expect(find.text('Fitness (CTL)'), findsOneWidget);
    expect(find.text('Fatigue (ATL)'), findsOneWidget);
    expect(find.text('Form (TSB)'), findsOneWidget);
  });

  testWidgets('forecast unavailable variants', (tester) async {
    final noData = _view(tweak: (j) => j..['forecast'] = {'status': 'unavailable-no-data'});
    await tester.pumpWidget(_wrap(PlanForecastCard(forecast: noData.forecast)));
    expect(find.text('Not enough planned load to forecast'), findsOneWidget);
    final done = _view(tweak: (j) => j..['forecast'] = {'status': 'unavailable-complete'});
    await tester.pumpWidget(_wrap(PlanForecastCard(forecast: done.forecast)));
    expect(find.text('This block is finished'), findsOneWidget);
  });

  testWidgets('forecast read failure offers retry', (tester) async {
    var retried = false;
    await tester.pumpWidget(_wrap(PlanForecastCard.failed(onRetry: () => retried = true)));
    expect(find.text("Couldn't load the forecast"), findsOneWidget);
    await tester.tap(find.text('Retry'));
    expect(retried, isTrue);
  });
}
