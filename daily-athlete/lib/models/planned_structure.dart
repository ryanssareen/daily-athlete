// Defensive readers over `planned_workouts.structure` JSONB.
//
// This is a 1:1 Dart port of apps/web/src/ai/planned-structure.ts — see that
// file's comments for the full "three duration spellings" history and why a
// wrong read here degrades to "unavailable" rather than a visible bug. Keep
// the semantics identical by hand (no TS/Dart codegen across this boundary,
// see AGENTS.md); `packages/shared/test-fixtures/planned-structure-vectors.json`
// is the shared golden-fixture table that guards both ports against drift
// (KTD2a in docs/plans/2026-08-27-001-feat-planned-workout-detail-rendering-plan.md).

import 'workout_report.dart' show IntensityTarget, IntensityTargetKind;

/// Read a finite number off a structure map. Anything absent, non-numeric, or
/// non-finite reads as null -- callers degrade that dimension rather than
/// propagating a bad value into arithmetic.
num? readStructureNumber(Map<String, dynamic>? structure, String key) {
  if (structure == null) return null;
  final v = structure[key];
  if (v is num && v.isFinite) return v;
  return null;
}

/// Prescribed duration in SECONDS, across every spelling that exists in
/// production `planned_workouts.structure` payloads: `duration_s` (seconds,
/// checked first), then `est_duration_min`/`total_duration_min` (minutes,
/// converted to seconds here at the read boundary). Returns null if none of
/// the three are present.
const _durationMinuteKeys = ['est_duration_min', 'total_duration_min'];

double? readStructureDurationSeconds(Map<String, dynamic>? structure) {
  final seconds = readStructureNumber(structure, 'duration_s');
  if (seconds != null) return seconds.toDouble();
  for (final key in _durationMinuteKeys) {
    final minutes = readStructureNumber(structure, key);
    if (minutes != null) return minutes.toDouble() * 60;
  }
  return null;
}

/// Prescribed load, preferring the structure's own `load` over the passed-in
/// column value. Returns null when neither is present.
double? readStructureLoad(Map<String, dynamic>? structure, num? plannedLoadColumn) {
  final fromStructure = readStructureNumber(structure, 'load');
  if (fromStructure != null) return fromStructure.toDouble();
  return plannedLoadColumn?.toDouble();
}

/// The prescribed intensity target, when the structure carries one in the
/// frozen `IntensityTarget` shape. Free-text intensity (which production also
/// contains) parses as null rather than being coerced.
IntensityTarget? readStructureIntensityTarget(Map<String, dynamic>? structure) {
  if (structure == null) return null;
  final raw = structure['intensity_target'];
  if (raw is! Map) return null;
  final kindRaw = raw['kind'];
  final valueRaw = raw['value'];
  if (kindRaw is! String || valueRaw is! num) return null;
  final kind = switch (kindRaw) {
    'ftp_pct' => IntensityTargetKind.ftpPct,
    'zone' => IntensityTargetKind.zone,
    'pace_s_per_km' => IntensityTargetKind.paceSPerKm,
    _ => null,
  };
  if (kind == null) return null;
  return IntensityTarget(kind: kind, value: valueRaw.toDouble());
}

/// Display string for a prescribed intensity target: "N% FTP", "Zone N", or
/// "M:SS/km pace" (e.g. "4:30/km pace" for 270 seconds). Verified against
/// `planned-structure-vectors.json`'s `expected_display_string` column
/// (KTD6) so this doesn't disagree with the web formatter's wording.
String formatIntensityTarget(IntensityTarget target) {
  switch (target.kind) {
    case IntensityTargetKind.ftpPct:
      return '${target.value.round()}% FTP';
    case IntensityTargetKind.zone:
      return 'Zone ${target.value.round()}';
    case IntensityTargetKind.paceSPerKm:
      final totalSeconds = target.value.round();
      final m = totalSeconds ~/ 60;
      final s = totalSeconds % 60;
      return '$m:${s.toString().padLeft(2, '0')}/km pace';
  }
}

/// One best-effort step extracted from a legacy `blocks`/`sets` entry.
class PlannedStep {
  const PlannedStep({this.label, this.durationS, this.displayString});

  final String? label;
  final double? durationS;
  final String? displayString;
}

const _labelKeys = ['label', 'name', 'description'];

String? _readEntryLabel(Map<String, dynamic> entry) {
  for (final key in _labelKeys) {
    final v = entry[key];
    if (v is String) return v;
  }
  return null;
}

/// KTD5 allow-list: for each entry in a legacy `blocks`/`sets` array, read
/// only a label (`label`/`name`/`description`, string), a duration (via
/// [readStructureDurationSeconds] applied to the entry itself), and an
/// intensity (via [readStructureIntensityTarget] + [formatIntensityTarget]
/// applied to the entry itself). Any other field is ignored. An entry where
/// all three resolve to nothing is dropped from the result entirely.
List<PlannedStep> extractPlannedSteps(Map<String, dynamic>? structure) {
  if (structure == null) return [];
  final raw = structure['blocks'] ?? structure['sets'];
  if (raw is! List) return [];

  final steps = <PlannedStep>[];
  for (final item in raw) {
    if (item is! Map) continue;
    final entry = item.map((key, value) => MapEntry(key.toString(), value));

    final label = _readEntryLabel(entry);
    final durationS = readStructureDurationSeconds(entry);
    final intensity = readStructureIntensityTarget(entry);
    final displayString = intensity != null ? formatIntensityTarget(intensity) : null;

    if (label == null && durationS == null && displayString == null) {
      continue;
    }

    steps.add(PlannedStep(label: label, durationS: durationS, displayString: displayString));
  }
  return steps;
}
