import 'package:flutter/painting.dart';

/// Sport enum — must stay in sync with:
///   - packages/shared/src/planned-workout.ts SportSchema
///   - DB CHECK constraints on planned_workouts.sport and completed_workouts.sport
///
/// If a new sport is added to the DB, update all three in the same PR.
enum Sport {
  swim,
  bike,
  run,
  strength,
  mobility,
  other;

  static Sport fromString(String value) {
    return Sport.values.firstWhere(
      (s) => s.name == value,
      orElse: () => Sport.other,
    );
  }

  /// Canonical sport palette. Keep in sync with
  /// apps/web/src/components/training-overview/sport-colors.ts.
  Color get color {
    switch (this) {
      case Sport.run:
        return const Color(0xFFC45A30);
      case Sport.bike:
        return const Color(0xFF2D6B44);
      case Sport.swim:
        return const Color(0xFF1A6891);
      case Sport.strength:
        return const Color(0xFF4A3A80);
      case Sport.mobility:
        return const Color(0xFF6B4C22);
      case Sport.other:
        return const Color(0xFF8A8478);
    }
  }

  String get displayName {
    switch (this) {
      case Sport.swim:
        return 'Swim';
      case Sport.bike:
        return 'Bike';
      case Sport.run:
        return 'Run';
      case Sport.strength:
        return 'Strength';
      case Sport.mobility:
        return 'Mobility';
      case Sport.other:
        return 'Other';
    }
  }
}
