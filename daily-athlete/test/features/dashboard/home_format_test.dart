import 'package:daily_athlete/features/dashboard/home_format.dart';
import 'package:daily_athlete/models/athlete_overview.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('fmtHm renders h:mm', () {
    expect(fmtHm(20940), '5:49');
    expect(fmtHm(0), '0:00');
    expect(fmtHm(3600 + 59 * 60 + 40), '2:00');
  });

  test('weekRangeLabel spans month boundaries', () {
    expect(weekRangeLabel(DateTime(2026, 10, 10)), 'Oct 5–11');
    expect(weekRangeLabel(DateTime(2026, 9, 30)), 'Sep 28 – Oct 4');
  });

  test('relativeDayLabel says Today for the current local day', () {
    final now = DateTime(2026, 10, 10, 12);
    expect(relativeDayLabel(DateTime(2026, 10, 10, 6), now), 'Today');
    expect(relativeDayLabel(DateTime(2026, 10, 9, 6), now), 'Fri 9 Oct');
  });

  test('fmtShortIsoDate reads a date-only string without timezone shifts', () {
    expect(fmtShortIsoDate('2026-10-09'), '9 Oct');
    expect(fmtShortIsoDate('2026-01-01'), '1 Jan');
    expect(fmtShortIsoDate('garbage'), 'garbage');
  });

  test('signed1 uses a real minus sign', () {
    expect(signed1(-7.34), '−7.3');
    expect(signed1(2.0), '+2.0');
  });

  test('formVerdict thresholds match the web', () {
    expect(formVerdict(6), 'Fresh');
    expect(formVerdict(-7.3), 'Neutral');
    expect(formVerdict(-20), 'Heavy load');
    expect(formVerdict(-40), 'Very fatigued');
  });

  test('AthleteOverview parses the API payload', () {
    final o = AthleteOverview.fromJson({
      'greeting': 'Good morning',
      'firstName': 'Rupesh',
      'timezone': 'Asia/Kolkata',
      'overview': {
        'ctl': 49.8,
        'atl': 57.1,
        'tsb': -7.3,
        'series': [
          {'date': '2026-10-10', 'tss': 0, 'ctl': 49.8, 'atl': 57.1, 'tsb': -7.3},
        ],
        'last28': {'hours': 37.2, 'prevHours': 44.0, 'deltaPct': -0.16},
        'race': {'label': 'Ironman 70.3', 'date': '2026-11-01', 'days': 22},
        'hasData': true,
      },
    });
    expect(o.firstName, 'Rupesh');
    expect(o.race?.days, 22);
    expect(o.series.single.tsb, -7.3);
  });
}
