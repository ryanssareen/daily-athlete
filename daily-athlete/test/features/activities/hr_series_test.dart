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
}
