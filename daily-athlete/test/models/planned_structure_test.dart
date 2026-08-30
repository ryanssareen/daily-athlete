// Loads the shared golden-fixture vectors from
// packages/shared/test-fixtures/planned-structure-vectors.json and asserts
// planned_structure.dart's readers/formatter/step-extractor against them.
// The same rows are asserted against by
// apps/web/src/ai/__tests__/planned-structure.test.ts (KTD2a in
// docs/plans/2026-08-27-001-feat-planned-workout-detail-rendering-plan.md),
// so a semantic disagreement between the Dart port and the TS original fails
// here rather than passing silently on one side.

import 'dart:convert';
import 'dart:io';

import 'package:daily_athlete/models/planned_structure.dart';
import 'package:daily_athlete/models/workout_report.dart' show IntensityTargetKind;
import 'package:flutter_test/flutter_test.dart';

/// Walks up from the current working directory to find the repo root (the
/// directory containing `packages/shared/test-fixtures/...`), so the test
/// resolves the fixture regardless of whether `flutter test` is invoked from
/// `daily-athlete/` (the documented convention) or the monorepo root.
File _locateFixture() {
  const relative = 'packages/shared/test-fixtures/planned-structure-vectors.json';
  var dir = Directory.current;
  for (var i = 0; i < 6; i++) {
    final candidate = File('${dir.path}/$relative');
    if (candidate.existsSync()) return candidate;
    final parent = dir.parent;
    if (parent.path == dir.path) break;
    dir = parent;
  }
  throw FileSystemException(
    'Could not locate planned-structure-vectors.json above ${Directory.current.path}',
  );
}

Map<String, dynamic>? _asMap(dynamic v) => v == null ? null : Map<String, dynamic>.from(v as Map);

void main() {
  final fixtureFile = _locateFixture();
  final fixture = jsonDecode(fixtureFile.readAsStringSync()) as Map<String, dynamic>;

  group('duration_load_intensity vectors', () {
    final rows = fixture['duration_load_intensity'] as List;
    for (final row in rows) {
      final r = row as Map<String, dynamic>;
      test(r['name'] as String, () {
        final structure = _asMap(r['structure_input']);
        final plannedLoadColumn = r['planned_load_column'] as num?;

        expect(readStructureDurationSeconds(structure), r['expected_duration_s']);
        expect(readStructureLoad(structure, plannedLoadColumn), r['expected_load']);

        final expectedIntensity = _asMap(r['expected_intensity_target']);
        final intensity = readStructureIntensityTarget(structure);
        if (expectedIntensity == null) {
          expect(intensity, isNull);
        } else {
          expect(intensity, isNotNull);
          final expectedKind = switch (expectedIntensity['kind'] as String) {
            'ftp_pct' => IntensityTargetKind.ftpPct,
            'zone' => IntensityTargetKind.zone,
            'pace_s_per_km' => IntensityTargetKind.paceSPerKm,
            final other => throw ArgumentError('Unknown kind: $other'),
          };
          expect(intensity!.kind, expectedKind);
          expect(intensity.value, expectedIntensity['value']);
        }

        final expectedDisplay = r['expected_display_string'] as String?;
        if (expectedDisplay == null) {
          expect(intensity, isNull, reason: 'no display string expected implies no target');
        } else {
          expect(formatIntensityTarget(intensity!), expectedDisplay);
        }
      });
    }
  });

  group('legacy_steps vectors', () {
    final rows = fixture['legacy_steps'] as List;
    for (final row in rows) {
      final r = row as Map<String, dynamic>;
      test(r['name'] as String, () {
        final structure = _asMap(r['structure_input']);
        final expectedSteps = r['expected_steps'] as List;

        final steps = extractPlannedSteps(structure);

        expect(steps.length, expectedSteps.length);
        for (var i = 0; i < expectedSteps.length; i++) {
          final expected = expectedSteps[i] as Map<String, dynamic>;
          final actual = steps[i];
          expect(actual.label, expected['label']);
          expect(actual.durationS, expected['duration_s']);
          expect(actual.displayString, expected['display_string']);
        }
      });
    }
  });
}
