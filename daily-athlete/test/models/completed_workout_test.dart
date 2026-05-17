import 'package:daily_athlete/models/completed_workout.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final stravaJson = {
    'id': 'cw-1',
    'athlete_id': 'user-1',
    'source': 'strava',
    'started_at': '2026-06-01T08:00:00.000Z',
    'sport': 'run',
    'summary_stats': {'name': 'Morning Run', 'avg_hr': 155},
    'strava_activity_id': 12345678,
    'distance_m': 10500.0,
    'duration_s': 3600,
    'superseded_by_id': null,
    'created_at': '2026-06-01T08:00:00.000Z',
    'deleted_at': null,
  };

  group('CompletedWorkoutRow', () {
    test('fromJson parses all fields including summary_stats JSONB', () {
      final row = CompletedWorkoutRow.fromJson(stravaJson);
      expect(row.id, 'cw-1');
      expect(row.source, CompletedWorkoutSource.strava);
      expect(row.sport, Sport.run);
      expect(row.stravaActivityId, 12345678);
      expect(row.distanceM, 10500.0);
      expect(row.durationS, 3600);
      expect(row.name, 'Morning Run');
    });

    test('fromJson handles strava_activity_id = null (manual row)', () {
      final manualJson = Map<String, dynamic>.from(stravaJson)
        ..['source'] = 'manual'
        ..['strava_activity_id'] = null;
      final row = CompletedWorkoutRow.fromJson(manualJson);
      expect(row.stravaActivityId, isNull);
      expect(row.source, CompletedWorkoutSource.manual);
    });

    test('name returns null when summary_stats has no name key', () {
      final noName = Map<String, dynamic>.from(stravaJson)
        ..['summary_stats'] = {'avg_hr': 155};
      final row = CompletedWorkoutRow.fromJson(noName);
      expect(row.name, isNull);
    });

    test('fromJson does not throw on extra unknown keys', () {
      final withExtra = Map<String, dynamic>.from(stravaJson)
        ..['future_field'] = 42;
      expect(() => CompletedWorkoutRow.fromJson(withExtra), returnsNormally);
    });
  });
}
