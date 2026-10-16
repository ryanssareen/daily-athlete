import 'package:daily_athlete/core/app_theme.dart';
import 'package:daily_athlete/features/shared/day_strip.dart';
import 'package:daily_athlete/features/shared/eyebrow.dart';
import 'package:daily_athlete/features/shared/load_bar.dart';
import 'package:daily_athlete/features/shared/metric_tile.dart';
import 'package:daily_athlete/features/shared/sport_tile.dart';
import 'package:daily_athlete/features/shared/status_pill.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Widget _host(Widget child, {Brightness brightness = Brightness.light}) {
  return MaterialApp(
    theme: brightness == Brightness.light ? lightTheme : darkTheme,
    home: MediaQuery(
      data: const MediaQueryData(size: Size(375, 800), textScaler: TextScaler.linear(2.0)),
      child: Scaffold(body: Padding(padding: const EdgeInsets.all(20), child: child)),
    ),
  );
}

void main() {
  for (final brightness in Brightness.values) {
    testWidgets('shared widgets lay out at 2x text on 375pt (${brightness.name})', (tester) async {
      await tester.pumpWidget(_host(
        SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Eyebrow('Sat · 10 Oct'),
              const MetricTile(label: 'Fitness (CTL)', value: '49.8', sub: 'Long-run training load'),
              Row(children: [
                SportTile(sport: Sport.run),
                const SizedBox(width: 8),
                const Expanded(child: StatusPill('Note ready')),
              ]),
              const LoadBar(value: 0.6),
              DayStrip(days: [
                for (var i = 0; i < 7; i++)
                  DayStripDay(
                    letter: 'MTWTFSS'[i],
                    dayNumber: 5 + i,
                    sports: const [Sport.run, Sport.bike],
                    isToday: i == 5,
                  ),
              ]),
            ],
          ),
        ),
        brightness: brightness,
      ));
      expect(tester.takeException(), isNull);
      expect(find.text('SAT · 10 OCT'), findsOneWidget);
    });
  }
}
