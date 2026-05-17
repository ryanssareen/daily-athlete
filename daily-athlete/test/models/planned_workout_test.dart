import 'package:daily_athlete/models/planned_workout.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final sampleJson = {
    'id': 'pw-1',
    'athlete_id': 'user-1',
    'scheduled_date': '2026-06-01',
    'sport': 'run',
    'structure': {'intervals': 4, 'duration_s': 300},
    'status': 'planned',
    'plan_id': 'plan-1',
    'planned_load': 85.5,
    'rationale': 'Tempo intervals',
    'edited_by_kind': null,
    'edited_by_user_id': null,
    'edited_at': null,
    'created_at': '2026-05-01T00:00:00.000Z',
    'deleted_at': null,
  };

  group('PlannedWorkoutRow', () {
    test('fromJson parses all fields including nested structure JSONB', () {
      final row = PlannedWorkoutRow.fromJson(sampleJson);
      expect(row.id, 'pw-1');
      expect(row.athleteId, 'user-1');
      expect(row.scheduledDate, DateTime(2026, 6, 1));
      expect(row.sport, Sport.run);
      expect(row.structure['intervals'], 4);
      expect(row.status, PlannedWorkoutStatus.planned);
      expect(row.plannedLoad, 85.5);
    });

    test('fromJson handles null optional fields without throwing', () {
      final sparse = Map<String, dynamic>.from(sampleJson)
        ..['plan_id'] = null
        ..['planned_load'] = null
        ..['rationale'] = null;
      final row = PlannedWorkoutRow.fromJson(sparse);
      expect(row.planId, isNull);
      expect(row.plannedLoad, isNull);
    });

    test('fromJson does not throw on extra unknown keys', () {
      final withExtra = Map<String, dynamic>.from(sampleJson)
        ..['future_column'] = 'some_value';
      expect(() => PlannedWorkoutRow.fromJson(withExtra), returnsNormally);
    });

    test('toJson round-trips through fromJson', () {
      final original = PlannedWorkoutRow.fromJson(sampleJson);
      final roundTripped = PlannedWorkoutRow.fromJson({
        ...original.toJson(),
        'created_at': sampleJson['created_at'],
        'deleted_at': null,
        'edited_by_kind': null,
        'edited_by_user_id': null,
        'edited_at': null,
      });
      expect(roundTripped.id, original.id);
      expect(roundTripped.sport, original.sport);
      expect(roundTripped.status, original.status);
    });
  });
}
