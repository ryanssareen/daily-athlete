import '../features/settings/units_notifier.dart';
import '../models/sport.dart';

// Conversion constants.
const double _metersPerMile = 1609.344;
const double _metersPerYard = 0.9144;

/// Formats a distance (in metres) per the user's unit preferences.
///
/// Swim distances use the swim-distance preference (m / yards); every other
/// sport uses the distance preference (km / miles).
String formatDistance(double meters, UnitsPrefs prefs, Sport sport) {
  if (sport == Sport.swim) {
    if (prefs.swimDistance == 'yards') {
      return '${(meters / _metersPerYard).round()} yd';
    }
    return '${meters.round()} m';
  }
  if (prefs.distance == 'miles') {
    return '${(meters / _metersPerMile).toStringAsFixed(1)} mi';
  }
  return '${(meters / 1000).toStringAsFixed(1)} km';
}

/// Formats pace (run/swim/etc.) or speed (bike) per the user's unit
/// preferences. Returns an empty string when distance or duration is missing.
String formatPaceOrSpeed(double meters, int seconds, UnitsPrefs prefs, Sport sport) {
  if (meters <= 0 || seconds <= 0) return '';

  if (sport == Sport.bike) {
    if (prefs.distance == 'miles') {
      final mph = (meters / _metersPerMile) / (seconds / 3600);
      return '${mph.toStringAsFixed(1)} mph';
    }
    final kmh = (meters / 1000) / (seconds / 3600);
    return '${kmh.toStringAsFixed(1)} km/h';
  }

  // Pace = time per unit distance.
  final double unitMeters;
  final String label;
  if (sport == Sport.swim) {
    if (prefs.swimDistance == 'yards') {
      unitMeters = 100 * _metersPerYard; // per 100 yd
      label = '/100yd';
    } else {
      unitMeters = 100; // per 100 m
      label = '/100m';
    }
  } else if (prefs.distance == 'miles') {
    unitMeters = _metersPerMile;
    label = '/mi';
  } else {
    unitMeters = 1000;
    label = '/km';
  }

  final paceSeconds = (seconds / meters) * unitMeters;
  final m = paceSeconds ~/ 60;
  final s = (paceSeconds % 60).round().toString().padLeft(2, '0');
  return '$m:$s $label';
}
