// Shared distance formatting so every screen honors the athlete's unit
// preference (UnitsPrefs.distance, 'km' | 'miles') instead of hardcoding km.

const kmToMiles = 0.621371;

/// Formats a meter distance per the athlete's distance unit preference.
String formatDistanceM(double meters, String distanceUnit, {int decimals = 1}) {
  final km = meters / 1000;
  if (distanceUnit == 'miles') {
    return '${(km * kmToMiles).toStringAsFixed(decimals)} mi';
  }
  return '${km.toStringAsFixed(decimals)} km';
}

/// Formats a km/h speed per the athlete's distance unit preference.
String formatSpeedKmh(double kmh, String distanceUnit, {int decimals = 1}) {
  if (distanceUnit == 'miles') {
    return '${(kmh * kmToMiles).toStringAsFixed(decimals)} mph';
  }
  return '${kmh.toStringAsFixed(decimals)} km/h';
}
