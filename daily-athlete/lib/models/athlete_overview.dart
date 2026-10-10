/// Mirrors GET /api/athlete/overview (apps/web/app/api/athlete/overview).
class LoadPoint {
  const LoadPoint({
    required this.date,
    required this.ctl,
    required this.atl,
    required this.tsb,
  });

  final String date;
  final double ctl;
  final double atl;
  final double tsb;

  factory LoadPoint.fromJson(Map<String, dynamic> json) => LoadPoint(
        date: json['date'] as String,
        ctl: (json['ctl'] as num).toDouble(),
        atl: (json['atl'] as num).toDouble(),
        tsb: (json['tsb'] as num).toDouble(),
      );
}

class RaceInfo {
  const RaceInfo({required this.label, required this.date, required this.days});

  final String label;
  final String date;
  final int days;

  factory RaceInfo.fromJson(Map<String, dynamic> json) => RaceInfo(
        label: json['label'] as String,
        date: json['date'] as String,
        days: (json['days'] as num).toInt(),
      );
}

/// Mirrors formVerdict in apps/web/src/training-overview/calc.ts, capitalised.
String formVerdict(double tsb) {
  if (tsb > 5) return 'Fresh';
  if (tsb >= -10) return 'Neutral';
  if (tsb >= -30) return 'Heavy load';
  return 'Very fatigued';
}

class AthleteOverview {
  const AthleteOverview({
    required this.greeting,
    required this.firstName,
    required this.ctl,
    required this.atl,
    required this.tsb,
    required this.series,
    required this.last28Hours,
    required this.last28DeltaPct,
    required this.race,
    required this.hasData,
  });

  final String greeting;
  final String? firstName;
  final double ctl;
  final double atl;
  final double tsb;
  final List<LoadPoint> series;
  final double last28Hours;
  final double? last28DeltaPct;
  final RaceInfo? race;
  final bool hasData;

  factory AthleteOverview.fromJson(Map<String, dynamic> json) {
    final overview = json['overview'] as Map<String, dynamic>;
    final last28 = overview['last28'] as Map<String, dynamic>;
    final race = overview['race'] as Map<String, dynamic>?;
    return AthleteOverview(
      greeting: json['greeting'] as String,
      firstName: json['firstName'] as String?,
      ctl: (overview['ctl'] as num).toDouble(),
      atl: (overview['atl'] as num).toDouble(),
      tsb: (overview['tsb'] as num).toDouble(),
      series: (overview['series'] as List)
          .map((e) => LoadPoint.fromJson(e as Map<String, dynamic>))
          .toList(),
      last28Hours: (last28['hours'] as num).toDouble(),
      last28DeltaPct: (last28['deltaPct'] as num?)?.toDouble(),
      race: race == null ? null : RaceInfo.fromJson(race),
      hasData: overview['hasData'] as bool,
    );
  }
}
