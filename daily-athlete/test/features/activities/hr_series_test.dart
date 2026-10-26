import 'dart:convert';

import 'package:daily_athlete/features/activities/hr_series.dart';
import 'package:daily_athlete/features/activities/hr_series_card.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('parseHrSeriesResponse', () {
    test('parses an ok body', () {
      final body = jsonEncode({
        'status': 'ok',
        'resolution': 'minute',
        'points': [
          {'minute': 0, 'avg': 120, 'max': 130},
          {'minute': 1, 'avg': 140, 'max': 151},
        ],
      });
      final r = parseHrSeriesResponse(200, body);
      expect(r.status, HrSeriesStatus.ok);
      expect(r.points.map((p) => p.avg), [120, 140]);
      expect(r.points.last.max, 151);
    });

    test('maps status codes', () {
      expect(parseHrSeriesResponse(429, '{}').status, HrSeriesStatus.rateLimited);
      expect(parseHrSeriesResponse(401, '{}').status, HrSeriesStatus.reauthRequired);
      expect(parseHrSeriesResponse(502, '{}').status, HrSeriesStatus.error);
    });

    test('treats unavailable, empty and malformed bodies safely', () {
      expect(parseHrSeriesResponse(200, '{"status":"unavailable"}').status, HrSeriesStatus.unavailable);
      expect(
        parseHrSeriesResponse(200, '{"status":"ok","points":[]}').status,
        HrSeriesStatus.unavailable,
      );
      expect(parseHrSeriesResponse(200, 'not json').status, HrSeriesStatus.error);
    });
  });

  testWidgets('HrMinuteChart renders for a series with a gap', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: HrMinuteChart(points: [
          HrMinutePoint(minute: 0, avg: 110, max: 118),
          HrMinutePoint(minute: 1, avg: 130, max: 140),
          HrMinutePoint(minute: 5, avg: 150, max: 160),
          HrMinutePoint(minute: 6, avg: 145, max: 155),
        ]),
      ),
    ));
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.byType(LineChart), findsOneWidget);
  });

  test('parses cadence and speed when present', () {
    final body = jsonEncode({
      'status': 'ok',
      'points': [
        {'minute': 0, 'avg': 140, 'max': 150, 'cadence': 172, 'speed': 3.1},
        {'minute': 1, 'avg': 142, 'max': 151},
      ],
    });
    final r = parseHrSeriesResponse(200, body);
    expect(r.points.first.cadence, 172);
    expect(r.points.first.speed, 3.1);
    expect(r.points.last.cadence, isNull);
    expect(r.points.last.speed, isNull);
  });

  test('formatPace renders min:sec per km and per mile', () {
    expect(HrMinuteChart.formatPace(3.0, false), '5:33');
    expect(HrMinuteChart.formatPace(3.0, true), '8:56');
  });

  testWidgets('HrMinuteChart overlays cadence and pace for runs', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: HrMinuteChart(points: [
          HrMinutePoint(minute: 0, avg: 120, max: 125, cadence: 160, speed: 2.8),
          HrMinutePoint(minute: 1, avg: 140, max: 150, cadence: 172, speed: 3.1),
          HrMinutePoint(minute: 2, avg: 150, max: 158, cadence: 176, speed: 3.3),
        ]),
      ),
    ));
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(find.byType(LineChart), findsOneWidget);
    expect(find.textContaining('Cadence 160–176 spm'), findsOneWidget);
    expect(find.textContaining('Pace'), findsOneWidget);
    final chart = tester.widget<LineChart>(find.byType(LineChart));
    expect(chart.data.lineBarsData, hasLength(3));
  });
}
