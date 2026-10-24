import 'package:daily_athlete/features/activities/strava_extras.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('parseKmSplits', () {
    test('computes pace per km and skips malformed entries', () {
      final splits = parseKmSplits({
        'splits_metric': [
          {'split': 1, 'distance': 1000, 'elapsed_time': 300, 'average_heartrate': 150.4},
          {'split': 2, 'distance': 500, 'elapsed_time': 160},
          {'split': 3, 'distance': 0, 'elapsed_time': 100},
          'junk',
        ],
      });
      expect(splits.length, 2);
      expect(splits[0].secondsPerKm, 300);
      expect(splits[0].heartRate, 150);
      expect(splits[1].secondsPerKm, 320);
    });

    test('is empty without data', () {
      expect(parseKmSplits({}), isEmpty);
      expect(parseKmSplits({'splits_metric': 'x'}), isEmpty);
    });

    test('paceBarFraction is 1.0 for the fastest and 0.4 for the slowest', () {
      final all = parseKmSplits({
        'splits_metric': [
          {'split': 1, 'distance': 1000, 'elapsed_time': 300},
          {'split': 2, 'distance': 1000, 'elapsed_time': 360},
        ],
      });
      expect(paceBarFraction(all[0], all), closeTo(1.0, 1e-9));
      expect(paceBarFraction(all[1], all), closeTo(0.4, 1e-9));
    });
  });

  test('parseBestEfforts flags PRs', () {
    final efforts = parseBestEfforts({
      'best_efforts': [
        {'name': '1k', 'elapsed_time': 318, 'pr_rank': 1},
        {'name': '5k', 'elapsed_time': 1682, 'pr_rank': null},
      ],
    });
    expect(efforts.map((e) => e.isPr), [true, false]);
    expect(efforts.first.seconds, 318);
  });

  test('formatClock', () {
    expect(formatClock(318), '5:18');
    expect(formatClock(3400), '56:40');
    expect(formatClock(5500), '1:31:40');
  });

  test('equipmentRows and placeRows read only what is present', () {
    final eq = equipmentRows({
      'gear': {'name': 'Pegasus 41', 'distance': 412345},
      'device_name': 'Forerunner 265',
    });
    expect(eq.map((r) => r.value), ['Pegasus 41', '412 km', 'Forerunner 265']);
    expect(equipmentRows({}), isEmpty);

    final place = placeRows({
      'location_city': 'Pune',
      'location_country': 'India',
      'kudos_count': 7,
      'athlete_count': 1,
    });
    expect(place.map((r) => r.value), ['Pune, India', '7']);
  });
}
