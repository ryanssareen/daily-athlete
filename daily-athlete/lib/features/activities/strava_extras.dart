/// Parsers for the Strava detail fields stored in `summary_stats` by the web
/// backend: `splits_metric`, `best_efforts`, `gear` and place. Pure functions so
/// they can be unit tested without a widget tree.

/// One kilometre split, with a pace bar fraction relative to the run.
class KmSplit {
  const KmSplit({
    required this.index,
    required this.secondsPerKm,
    this.heartRate,
    this.elevationDiff,
  });

  final int index;
  final double secondsPerKm;
  final int? heartRate;
  final int? elevationDiff;
}

List<KmSplit> parseKmSplits(Map<String, dynamic> stats) {
  final raw = stats['splits_metric'];
  if (raw is! List) return const [];
  final out = <KmSplit>[];
  for (final s in raw) {
    if (s is! Map) continue;
    final distance = s['distance'];
    final elapsed = s['elapsed_time'];
    final split = s['split'];
    if (distance is! num || elapsed is! num || split is! num || distance <= 0) {
      continue;
    }
    out.add(KmSplit(
      index: split.toInt(),
      secondsPerKm: elapsed / distance * 1000,
      heartRate: (s['average_heartrate'] as num?)?.round(),
      elevationDiff: (s['elevation_difference'] as num?)?.round(),
    ));
  }
  return out;
}

/// Bar width as a fraction in 0.4–1.0, longer for faster splits.
double paceBarFraction(KmSplit split, List<KmSplit> all) {
  final paces = all.map((s) => s.secondsPerKm);
  final fastest = paces.reduce((a, b) => a < b ? a : b);
  final slowest = paces.reduce((a, b) => a > b ? a : b);
  final spread = slowest - fastest;
  if (spread <= 0) return 1.0;
  return 0.4 + (1 - (split.secondsPerKm - fastest) / spread) * 0.6;
}

class BestEffort {
  const BestEffort({required this.name, required this.seconds, required this.isPr});

  final String name;
  final int seconds;
  final bool isPr;
}

List<BestEffort> parseBestEfforts(Map<String, dynamic> stats) {
  final raw = stats['best_efforts'];
  if (raw is! List) return const [];
  final out = <BestEffort>[];
  for (final e in raw) {
    if (e is! Map) continue;
    final name = e['name'];
    final elapsed = e['elapsed_time'];
    if (name is! String || elapsed is! num) continue;
    out.add(BestEffort(
      name: name,
      seconds: elapsed.round(),
      isPr: e['pr_rank'] == 1,
    ));
  }
  return out;
}

/// `m:ss`, or `h:mm:ss` from an hour up.
String formatClock(num seconds) {
  final s = seconds.round() < 0 ? 0 : seconds.round();
  final h = s ~/ 3600;
  final m = (s % 3600) ~/ 60;
  final sec = (s % 60).toString().padLeft(2, '0');
  return h > 0 ? '$h:${m.toString().padLeft(2, '0')}:$sec' : '$m:$sec';
}

/// Label/value rows for the Equipment card. Empty when Strava sent none.
List<({String label, String value})> equipmentRows(Map<String, dynamic> stats) {
  final rows = <({String label, String value})>[];
  final gear = stats['gear'];
  if (gear is Map) {
    final name = gear['name'];
    if (name is String && name.isNotEmpty) {
      rows.add((label: 'Gear', value: name));
    }
    final distance = gear['distance'];
    if (distance is num) {
      rows.add((label: 'Gear lifetime', value: '${(distance / 1000).round()} km'));
    }
  }
  final device = stats['device_name'];
  if (device is String && device.isNotEmpty) {
    rows.add((label: 'Recorded on', value: device));
  }
  return rows;
}

/// Label/value rows for the Place & company card.
List<({String label, String value})> placeRows(Map<String, dynamic> stats) {
  final rows = <({String label, String value})>[];
  final place = [
    stats['location_city'],
    stats['location_state'],
    stats['location_country'],
  ].whereType<String>().where((p) => p.isNotEmpty).join(', ');
  if (place.isNotEmpty) rows.add((label: 'Location', value: place));
  final athletes = stats['athlete_count'];
  if (athletes is num && athletes > 1) {
    rows.add((label: 'Athletes', value: athletes.round().toString()));
  }
  final kudos = stats['kudos_count'];
  if (kudos is num && kudos > 0) {
    rows.add((label: 'Kudos', value: kudos.round().toString()));
  }
  final comments = stats['comment_count'];
  if (comments is num && comments > 0) {
    rows.add((label: 'Comments', value: comments.round().toString()));
  }
  return rows;
}
