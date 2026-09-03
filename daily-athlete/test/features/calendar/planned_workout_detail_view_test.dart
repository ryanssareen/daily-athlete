// test/features/calendar/planned_workout_detail_view_test.dart
//
// Pure Dart tests for planned_workout_detail_view.dart's
// buildPlannedWorkoutView. Exercises the view-model function only -- no
// Flutter widget tree, no live Supabase call. Mirrors
// apps/web/src/components/planned/__tests__/planned-workout-view.test.ts's
// scenarios (KTD parity check, not identical layout).

import 'package:daily_athlete/features/calendar/planned_workout_detail_view.dart'
    show buildPlannedWorkoutView, formatDurationDisplay, notSetText, noIntensityTargetText;
import 'package:daily_athlete/models/planned_workout.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:flutter_test/flutter_test.dart';

PlannedWorkoutRow _row({
  Map<String, dynamic>? structure,
  String? rationale,
  double? plannedLoad,
}) {
  return PlannedWorkoutRow.fromJson({
    'id': 'workout-1',
    'athlete_id': 'user-1',
    'scheduled_date': '2026-08-30',
    'sport': Sport.run.name,
    'structure': structure ?? <String, dynamic>{},
    'status': 'planned',
    'plan_id': null,
    'planned_load': plannedLoad,
    'rationale': rationale,
    'edited_by_kind': null,
    'edited_by_user_id': null,
    'edited_at': null,
    'created_at': null,
    'deleted_at': null,
  });
}

void main() {
  group('buildPlannedWorkoutView', () {
    test('renders no rationale when null', () {
      final view = buildPlannedWorkoutView(_row(rationale: null));
      expect(view.rationale, isNull);
    });

    test('renders no rationale when blank', () {
      final view = buildPlannedWorkoutView(_row(rationale: '   '));
      expect(view.rationale, isNull);
    });

    test('renders rationale text when present', () {
      final view = buildPlannedWorkoutView(_row(rationale: 'Building aerobic base.'));
      expect(view.rationale, 'Building aerobic base.');
    });

    test(
      'passes an HTML-like description through as a literal string, never stripped/interpreted',
      () {
        const scriptLike = '<script>alert("xss")</script>';
        final view = buildPlannedWorkoutView(
          _row(structure: {'description': scriptLike}),
        );
        expect(view.description, scriptLike);
      },
    );

    test("renders the 'Not set' fallback when duration is unresolvable", () {
      final view = buildPlannedWorkoutView(_row(structure: {'phase': 'taper'}));
      expect(view.durationDisplay, notSetText);
    });

    test("renders the 'Not set' fallback when load is unresolvable", () {
      final view = buildPlannedWorkoutView(
        _row(structure: {'duration_s': 1800}, plannedLoad: null),
      );
      expect(view.loadDisplay, notSetText);
    });

    test('renders a resolved load', () {
      final view = buildPlannedWorkoutView(
        _row(structure: {'duration_s': 1800}, plannedLoad: 42),
      );
      expect(view.loadDisplay, '42 load');
    });

    test('renders duration parity with web view-model (1h 0m from duration_s: 3600)', () {
      final view = buildPlannedWorkoutView(_row(structure: {'duration_s': 3600}));
      expect(view.durationDisplay, '1h 0m');
    });

    test("renders the 'No target set' fallback for free-text intensity", () {
      // structure.intensity_target here is a free-text string, not the
      // frozen {kind, value} shape -- readStructureIntensityTarget parses
      // that as null rather than coercing it.
      final view = buildPlannedWorkoutView(
        _row(structure: {'intensity_target': 'hard effort, RPE 8'}),
      );
      expect(view.intensityDisplay, noIntensityTargetText);
    });

    test("renders the 'No target set' fallback when intensity is absent", () {
      final view = buildPlannedWorkoutView(_row(structure: {'duration_s': 1800}));
      expect(view.intensityDisplay, noIntensityTargetText);
    });

    test('renders a resolved intensity target ("Zone 3" from {kind: zone, value: 3})', () {
      final view = buildPlannedWorkoutView(
        _row(structure: {
          'intensity_target': {'kind': 'zone', 'value': 3},
        }),
      );
      expect(view.intensityDisplay, 'Zone 3');
    });

    test('returns null steps when structure carries no blocks/sets array', () {
      final view = buildPlannedWorkoutView(_row(structure: {'duration_s': 1800}));
      expect(view.steps, isNull);
    });

    test('derives a step list from a legacy blocks array, dropping non-allow-listed fields', () {
      final view = buildPlannedWorkoutView(
        _row(structure: {
          'blocks': [
            {
              'label': 'Warm-up',
              'duration_s': 600,
              'intensity_target': {'kind': 'zone', 'value': 1},
              'color': 'blue',
            },
          ],
        }),
      );
      expect(view.steps, hasLength(1));
      expect(view.steps![0].label, 'Warm-up');
      expect(view.steps![0].durationDisplay, '10m');
      expect(view.steps![0].intensityDisplay, 'Zone 1');
    });

    test('drops a legacy entry with none of label/duration/intensity present', () {
      final view = buildPlannedWorkoutView(
        _row(structure: {
          'sets': [
            {'label': 'Cool-down', 'duration_s': 300},
            {'color': 'red', 'weird_field': 123},
          ],
        }),
      );
      expect(view.steps, hasLength(1));
      expect(view.steps![0].label, 'Cool-down');
      expect(view.steps![0].durationDisplay, '5m');
      expect(view.steps![0].intensityDisplay, isNull);
    });

    test('does not throw when rationale and structure fields are empty/absent', () {
      expect(
        () => buildPlannedWorkoutView(
          _row(structure: <String, dynamic>{}, rationale: null, plannedLoad: null),
        ),
        returnsNormally,
      );
    });
  });

  group('formatDurationDisplay', () {
    test("renders 'Not set' for a negative value", () {
      expect(formatDurationDisplay(-5), notSetText);
    });

    test("renders 'Not set' for NaN", () {
      expect(formatDurationDisplay(double.nan), notSetText);
    });

    test("renders 'Not set' for zero", () {
      expect(formatDurationDisplay(0), notSetText);
    });
  });
}
