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
