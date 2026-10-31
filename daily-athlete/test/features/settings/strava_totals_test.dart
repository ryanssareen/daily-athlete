import 'package:daily_athlete/features/settings/strava_totals.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('parseStravaTotalsResponse', () {
    test('parses sports and periods', () {
      final out = parseStravaTotalsResponse(200, '''
{"status":"ok","sports":[{"sport":"run",
 "recent":{"count":2,"distance":10000,"moving_time":3000,"elevation_gain":40},
 "ytd":{"count":10,"distance":50000,"moving_time":15000,"elevation_gain":200},
 "all":{"count":50}}]}''');
      expect(out.length, 1);
      expect(out[0].label, 'Running');
      expect(out[0].recent.count, 2);
      expect(out[0].ytd.distanceM, 50000);
      expect(out[0].all.movingSec, 0);
    });

    test('is empty for non-200, unavailable or malformed bodies', () {
      expect(parseStravaTotalsResponse(429, '{}'), isEmpty);
      expect(parseStravaTotalsResponse(200, '{"status":"unavailable"}'), isEmpty);
      expect(parseStravaTotalsResponse(200, 'nope'), isEmpty);
    });
  });

  test('formatMovingTime', () {
    expect(formatMovingTime(125 * 60), '2h 5m');
    expect(formatMovingTime(45 * 60), '45m');
  });
}
