import 'package:flutter_test/flutter_test.dart';

import 'package:daily_athlete/features/onboarding/onboarding_api.dart';

void main() {
  final now = DateTime.utc(2026, 10, 26, 12);

  test('merge keeps unrelated fields and stamps onboarded_at', () {
    final merged = mergeManualFields(
      {'ftp_watts': 250},
      OnboardingAnswers(
        primarySport: 'run',
        weeklyHours: 6,
        trainingPattern: 'Evenings',
        eventType: 'Marathon',
        eventDate: DateTime(2027, 4, 5),
      ),
      now: now,
    );
    expect(merged['ftp_watts'], 250);
    expect(merged['primary_sport'], 'run');
    expect(merged['weekly_hours_avail'], 6);
    expect(merged['training_pattern'], 'Evenings');
    expect(merged['target_event'], {'type': 'Marathon', 'date': '2027-04-05'});
    expect(merged['onboarded_at'], '2026-10-26T12:00:00.000Z');
  });

  test('an event without a date is not saved and clears a stale one', () {
    final merged = mergeManualFields(
      {
        'target_event': {'type': '5K', 'date': '2026-12-01'},
      },
      const OnboardingAnswers(eventType: 'Marathon'),
      now: now,
    );
    expect(merged.containsKey('target_event'), isFalse);
  });
}
