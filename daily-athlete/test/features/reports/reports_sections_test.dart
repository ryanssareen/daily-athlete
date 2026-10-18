import 'package:daily_athlete/core/app_theme.dart';
import 'package:daily_athlete/features/reports/reports_sections.dart';
import 'package:daily_athlete/models/athlete_overview.dart';
import 'package:daily_athlete/models/period_review.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

PeriodReviewSummary period(PeriodKind kind, String key, double load, {bool narrated = true}) =>
    PeriodReviewSummary(
      kind: kind,
      periodKey: key,
      bounds: const PeriodBounds(start: '2026-09-28', end: '2026-10-04'),
      sessions: 14,
      durationS: 42720,
      load: load,
      hasNarration: narrated,
    );

AthleteOverview overview() => AthleteOverview.fromJson({
      'greeting': 'Good morning',
      'firstName': 'Rupesh',
      'overview': {
        'ctl': 49.8,
        'atl': 57.1,
        'tsb': -7.3,
        'series': [
          for (var i = 0; i < 5; i++)
            {'date': '2026-10-0${i + 1}', 'tss': 0, 'ctl': 49.0 + i, 'atl': 55.0 + i, 'tsb': -6.0 - i},
        ],
        'last28': {'hours': 37.2, 'prevHours': 44.0, 'deltaPct': -0.16},
        'race': {'label': 'Ironman 70.3 Staffordshire', 'date': '2026-11-01', 'days': 22},
        'weekly': [
          {'weekStart': '2026-09-21', 'bySport': {'bike': 3.0, 'run': 1.5}, 'totalH': 4.5},
          {'weekStart': '2026-09-28', 'bySport': {'bike': 6.0, 'swim': 1.0}, 'totalH': 7.0},
        ],
        'sports': [
          {'sport': 'bike', 'sessions28': 13, 'hours28': 20.9, 'sessionsAll': 30, 'hoursAll': 60.0},
        ],
        'hasData': true,
      },
    });

void main() {
  test('weeklyLoadBars keeps the newest weeks, oldest first, newest flagged', () {
    final periods = [
      period(PeriodKind.weekly, 'w4', 150),
      period(PeriodKind.monthly, 'm1', 999),
      period(PeriodKind.weekly, 'w3', 100),
      period(PeriodKind.weekly, 'w2', 50),
      period(PeriodKind.weekly, 'w1', 25),
    ];
    final bars = weeklyLoadBars(periods, count: 3);
    expect(bars.map((b) => b.load), [50, 100, 150]);
    expect(bars.map((b) => b.isCurrent), [false, false, true]);
    expect(priorAverageLoad(bars), 75);
    expect(priorAverageLoad([bars.last]), isNull);
  });

  test('loadChangeTone flags jumps over 30% and calls +-5% steady', () {
    expect(loadChangeTone(88), LoadChangeTone.spike);
    expect(loadChangeTone(31), LoadChangeTone.spike);
    expect(loadChangeTone(30), LoadChangeTone.up);
    expect(loadChangeTone(6), LoadChangeTone.up);
    expect(loadChangeTone(5), LoadChangeTone.steady);
    expect(loadChangeTone(-5), LoadChangeTone.steady);
    expect(loadChangeTone(-32), LoadChangeTone.down);
  });

  test('loadChangePct needs a positive baseline', () {
    expect(loadChangePct(498, 258), 93);
    expect(loadChangePct(258, 378), -32);
    expect(loadChangePct(100, null), isNull);
    expect(loadChangePct(100, 0), isNull);
  });

  test('previousOfKind skips periods of the other kind', () {
    final periods = [
      period(PeriodKind.weekly, 'a', 10),
      period(PeriodKind.monthly, 'm', 50),
      period(PeriodKind.weekly, 'b', 20),
    ];
    expect(previousOfKind(periods, 0)?.periodKey, 'b');
    expect(previousOfKind(periods, 2), isNull);
    expect(previousOfKind(periods, 1), isNull);
  });

  testWidgets('report sections lay out at 2x text on 375pt (light and dark)', (tester) async {
    for (final theme in [lightTheme, darkTheme]) {
      final o = overview();
      await tester.pumpWidget(MaterialApp(
        theme: theme,
        home: MediaQuery(
          data: const MediaQueryData(size: Size(375, 2000), textScaler: TextScaler.linear(2.0)),
          child: Scaffold(
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  KpiGrid(overview: o),
                  GoalEventStrip(race: o.race!),
                  FormChartCard(overview: o),
                  WeeklyHoursCard(weekly: o.weekly),
                  BySportCard(sports: o.sports),
                  ReviewCard(
                    summary: period(PeriodKind.weekly, 'a', 498),
                    previous: period(PeriodKind.weekly, 'b', 258, narrated: false),
                  ),
                  WeeklyLoadCard(
                    bars: weeklyLoadBars([
                      for (var i = 0; i < 8; i++)
                        period(PeriodKind.weekly, 'w$i', 100.0 + i * 20),
                    ]),
                  ),
                ],
              ),
            ),
          ),
        ),
      ));
      expect(tester.takeException(), isNull);
    }
  });
}
