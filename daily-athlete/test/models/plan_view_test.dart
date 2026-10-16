import 'dart:convert';
import 'dart:io';

import 'package:daily_athlete/models/plan_view.dart';
import 'package:daily_athlete/models/workout_report.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> _fixture() {
  final raw = File('../packages/shared/test-fixtures/plan-view-sample.json').readAsStringSync();
  return jsonDecode(raw) as Map<String, dynamic>;
}

void main() {
  test('parses the shared fixture', () {
    final view = PlanView.fromJson(_fixture());
    expect(view.planId, '7f0c3a52-6c1e-4f59-9a52-0d9a1d3b8a11');
    expect(view.story.paragraphs, hasLength(2));
    expect(view.story.whyQuote, isNotNull);
    expect(view.weeks, hasLength(2));
    expect(view.weeks.first.sessions, hasLength(2));
    expect(view.weeks.first.current, isTrue);
    expect(view.weeks.first.phase, PlanPhase.build);
    expect(view.weeks.first.compliance, 1.06);
    expect(view.weeks.first.skippedCount, 1);
    expect(view.weeks.first.sessions.first.verdict!.code, VerdictCode.executedAsPrescribed);
    expect(view.sectionErrors, isEmpty);
    final forecast = view.forecast;
    expect(forecast, isA<ForecastOk>());
    forecast as ForecastOk;
    expect(forecast.ctl, 52.4);
    expect(forecast.eventDay!.tsb, 7.8);
  });

  test('nullable fields parse as null', () {
    final view = PlanView.fromJson(_fixture());
    expect(view.weeks[1].phase, isNull);
    expect(view.weeks[1].compliance, isNull);
    final bike = view.weeks.first.sessions[1];
    expect(bike.verdict, isNull);
    expect(bike.plannedLoad, isNull);
    expect(bike.intensity, isNull);
    expect(bike.rationale, isNull);
  });

  test('null whyQuote and eventDay parse', () {
    final json = _fixture();
    (json['story'] as Map<String, dynamic>)['whyQuote'] = null;
    (json['forecast'] as Map<String, dynamic>)['eventDay'] = null;
    final view = PlanView.fromJson(json);
    expect(view.story.whyQuote, isNull);
    expect((view.forecast as ForecastOk).eventDay, isNull);
  });

  test('forecast variants parse', () {
    final a = _fixture()..['forecast'] = {'status': 'unavailable-no-data'};
    final b = _fixture()..['forecast'] = {'status': 'unavailable-complete'};
    expect(PlanView.fromJson(a).forecast, isA<ForecastUnavailableNoData>());
    expect(PlanView.fromJson(b).forecast, isA<ForecastUnavailableComplete>());
  });

  test('sectionErrors parse', () {
    final json = _fixture()..['sectionErrors'] = ['verdicts', 'forecast'];
    final view = PlanView.fromJson(json);
    expect(view.sectionErrors, {PlanSectionError.verdicts, PlanSectionError.forecast});
  });

  test('unknown verdict code throws FormatException', () {
    final json = _fixture();
    final weeks = json['weeks'] as List;
    final session = ((weeks.first as Map)['sessions'] as List).first as Map;
    session['verdict'] = {'code': 'nope', 'headline': 'x'};
    expect(() => PlanView.fromJson(json), throwsFormatException);
  });

  test('unknown forecast status throws FormatException', () {
    final json = _fixture()..['forecast'] = {'status': 'weird'};
    expect(() => PlanView.fromJson(json), throwsFormatException);
  });

  test('malformed payload throws FormatException', () {
    expect(() => PlanView.fromJson({'planId': 'x'}), throwsFormatException);
    final json = _fixture()..['weeks'] = 'nope';
    expect(() => PlanView.fromJson(json), throwsFormatException);
  });
}
