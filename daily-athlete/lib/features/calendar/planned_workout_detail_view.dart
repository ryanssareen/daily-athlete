// Pure view logic for the planned-workout detail screen (U3).
//
// 1:1 mirror of apps/web/src/components/planned/planned-workout-view.ts's
// `buildPlannedWorkoutView` — same fields, same fallback copy — so both
// platforms produce the same display values from the same
// `planned_workouts` row. Duration/load/intensity NORMALIZATION is not
// reimplemented here; it lives once in planned_structure.dart
// (readStructureDurationSeconds / readStructureLoad /
// readStructureIntensityTarget / formatIntensityTarget / extractPlannedSteps)
// and this file only formats those readers' output plus the step list.
//
// No Flutter imports here on purpose — pure Dart, no I/O, unit-testable.

import '../../models/planned_structure.dart';
import '../../models/planned_workout.dart';

const String notSetText = 'Not set';
const String noIntensityTargetText = 'No target set';

/// Formatted duration for display, e.g. "1h 30m" / "45m". [notSetText] when
/// the structure carries none of the three known duration spellings (or the
/// value is non-finite / non-positive).
String formatDurationDisplay(double? seconds) {
  if (seconds == null || !seconds.isFinite || seconds <= 0) return notSetText;
  final totalSeconds = seconds.round();
  final h = totalSeconds ~/ 3600;
  final m = ((totalSeconds % 3600) / 60).round();
  return h > 0 ? '${h}h ${m}m' : '${m}m';
}

/// Formatted load for display. [notSetText] when neither `structure.load`
/// nor the `planned_load` column carries a value.
String formatLoadDisplay(double? load) {
  if (load == null || !load.isFinite) return notSetText;
  return '${load.round()} load';
}

/// One step, ready to render.
class PlannedStepView {
  const PlannedStepView({
    required this.label,
    required this.durationDisplay,
    required this.intensityDisplay,
  });

  final String? label;
  final String durationDisplay;
  final String? intensityDisplay;
}

PlannedStepView _toStepView(PlannedStep step) {
  return PlannedStepView(
    label: step.label,
    durationDisplay: formatDurationDisplay(step.durationS),
    intensityDisplay: step.displayString,
  );
}

/// Ready-to-render display values for the planned-workout detail screen.
class PlannedWorkoutView {
  const PlannedWorkoutView({
    required this.rationale,
    required this.description,
    required this.durationDisplay,
    required this.loadDisplay,
    required this.intensityDisplay,
    required this.steps,
  });

  /// AI-authored rationale text, or null when absent/blank. Render as plain
  /// text — never any HTML-rendering widget (R7).
  final String? rationale;

  /// `structure.description`, or null when absent/blank. Render as plain
  /// text — never any HTML-rendering widget (R7).
  final String? description;

  /// [notSetText] fallback when unresolvable.
  final String durationDisplay;

  /// [notSetText] fallback when unresolvable.
  final String loadDisplay;

  /// [noIntensityTargetText] fallback when intensity is free-text or absent.
  final String intensityDisplay;

  /// Best-effort legacy step list, or null when `structure` carries no
  /// `blocks`/`sets` array to derive one from.
  final List<PlannedStepView>? steps;
}

String? _readStructureDescription(Map<String, dynamic>? structure) {
  if (structure == null) return null;
  final v = structure['description'];
  if (v is! String) return null;
  final trimmed = v.trim();
  return trimmed.isEmpty ? null : trimmed;
}

bool _hasLegacyStepsArray(Map<String, dynamic>? structure) {
  if (structure == null) return false;
  final raw = structure['blocks'] ?? structure['sets'];
  return raw is List;
}

/// Builds every display value the planned-workout detail screen needs from a
/// fetched row. Pure — no I/O, no Flutter.
PlannedWorkoutView buildPlannedWorkoutView(PlannedWorkoutRow row) {
  final structure = row.structure;
  final durationSeconds = readStructureDurationSeconds(structure);
  final load = readStructureLoad(structure, row.plannedLoad);
  final intensityTarget = readStructureIntensityTarget(structure);
  final hasStepsArray = _hasLegacyStepsArray(structure);

  final rationale = row.rationale?.trim();

  return PlannedWorkoutView(
    rationale: (rationale == null || rationale.isEmpty) ? null : rationale,
    description: _readStructureDescription(structure),
    durationDisplay: formatDurationDisplay(durationSeconds),
    loadDisplay: formatLoadDisplay(load),
    intensityDisplay: intensityTarget != null
        ? formatIntensityTarget(intensityTarget)
        : noIntensityTargetText,
    steps: hasStepsArray
        ? extractPlannedSteps(structure).map(_toStepView).toList()
        : null,
  );
}
