import 'package:daily_athlete/features/activities/hr_zones_card.dart';
import 'package:daily_athlete/features/activities/route_map_card.dart';
import 'package:daily_athlete/features/activities/workout_hydration_provider.dart';
import 'package:daily_athlete/models/completed_workout.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

CompletedWorkoutRow _workout({
  Sport sport = Sport.bike,
  CompletedWorkoutSource source = CompletedWorkoutSource.strava,
  int? stravaId = 42,
  Map<String, dynamic> stats = const {},
}) =>
    CompletedWorkoutRow(
      id: 'w1',
      athleteId: 'a1',
      source: source,
      startedAt: DateTime.utc(2026, 10, 18, 2, 51),
      sport: sport,
      summaryStats: stats,
      stravaActivityId: stravaId,
    );

void main() {
  group('decodePolyline', () {
    test('decodes the reference example from the encoding spec', () {
      final pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
      expect(pts, hasLength(3));
      expect(pts[0].lat, closeTo(38.5, 1e-9));
      expect(pts[0].lng, closeTo(-120.2, 1e-9));
      expect(pts[1].lat, closeTo(40.7, 1e-9));
      expect(pts[1].lng, closeTo(-120.95, 1e-9));
      expect(pts[2].lat, closeTo(43.252, 1e-9));
      expect(pts[2].lng, closeTo(-126.453, 1e-9));
    });

    test('returns empty for empty or truncated input', () {
      expect(decodePolyline(''), isEmpty);
      expect(decodePolyline('_p~iF~ps|U_ulL'), isEmpty);
    });
  });

  group('parseHrZones', () {
    test('reads the heartrate entry and ignores power zones', () {
      final buckets = parseHrZones({
        'zones': [
          {
            'type': 'power',
            'distribution_buckets': [
              {'min': 0, 'max': 100, 'time': 999},
            ],
          },
          {
            'type': 'heartrate',
            'distribution_buckets': [
              {'min': 0, 'max': 120, 'time': 600},
              {'min': 120, 'max': 150, 'time': 1800},
              {'min': 150, 'max': -1, 'time': 90},
            ],
          },
        ],
      });
      expect(buckets.map((b) => b.seconds), [600, 1800, 90]);
      expect(buckets.last.max, -1);
    });

    test('is empty when the workout is not hydrated or has no HR zones', () {
      expect(parseHrZones({}), isEmpty);
      expect(parseHrZones({'zones': <dynamic>[]}), isEmpty);
      expect(parseHrZones({'zones': 'nope'}), isEmpty);
    });
  });

  test('formatZoneTime', () {
    expect(formatZoneTime(45), '45s');
    expect(formatZoneTime(600), '10m');
    expect(formatZoneTime(5139), '1h 25m');
  });

  group('shouldHydrateWorkout', () {
    final now = DateTime.utc(2026, 10, 21, 15, 0);

    test('true for an unhydrated Strava ride', () {
      expect(shouldHydrateWorkout(_workout(), now: now), isTrue);
    });

    test('false once hydrated', () {
      final w = _workout(stats: {'hydrated_at': '2026-10-21T10:00:00Z'});
      expect(shouldHydrateWorkout(w, now: now), isFalse);
    });

    test('false for manual, no activity id, strength and mobility', () {
      expect(
        shouldHydrateWorkout(_workout(source: CompletedWorkoutSource.manual), now: now),
        isFalse,
      );
      expect(shouldHydrateWorkout(_workout(stravaId: null), now: now), isFalse);
      expect(shouldHydrateWorkout(_workout(sport: Sport.strength), now: now), isFalse);
      expect(shouldHydrateWorkout(_workout(sport: Sport.mobility), now: now), isFalse);
    });

    test('backs off for 10 minutes after a failed attempt, then retries', () {
      final recent = _workout(stats: {
        'hydrate_error_at': now.subtract(const Duration(minutes: 3)).toIso8601String(),
      });
      final old = _workout(stats: {
        'hydrate_error_at': now.subtract(const Duration(minutes: 30)).toIso8601String(),
      });
      expect(shouldHydrateWorkout(recent, now: now), isFalse);
      expect(shouldHydrateWorkout(old, now: now), isTrue);
    });
  });

  group('widgets', () {
    testWidgets('RouteMapCard paints for a valid polyline and hides for junk', (tester) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ListView(
            children: const [RouteMapCard(polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@')],
          ),
        ),
      ));
      expect(find.text('Route'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: RouteMapCard(polyline: '')),
      ));
      expect(find.text('Route'), findsNothing);
    });

    testWidgets('HrZonesBreakdown lists a row per zone', (tester) async {
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: HrZonesBreakdown(buckets: [
            HrZoneBucket(min: 0, max: 120, seconds: 600),
            HrZoneBucket(min: 120, max: -1, seconds: 1800),
          ]),
        ),
      ));
      expect(find.text('Time in zone'), findsOneWidget);
      expect(find.text('Z1'), findsOneWidget);
      expect(find.text('Z2'), findsOneWidget);
      expect(find.text('30m · 120+'), findsOneWidget);
    });
  });
}
