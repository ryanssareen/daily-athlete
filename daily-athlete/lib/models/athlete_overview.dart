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

class WeeklyBucket {
  const WeeklyBucket({required this.weekStart, required this.bySport, required this.totalH});

  /// Monday, "YYYY-MM-DD".
  final String weekStart;

  /// Hours per sport key ("run", "bike", ...).
  final Map<String, double> bySport;
  final double totalH;

  factory WeeklyBucket.fromJson(Map<String, dynamic> json) => WeeklyBucket(
        weekStart: json['weekStart'] as String,
        bySport: (json['bySport'] as Map<String, dynamic>)
            .map((k, v) => MapEntry(k, (v as num).toDouble())),
        totalH: (json['totalH'] as num).toDouble(),
      );
}

class SportRow {
  const SportRow({
    required this.sport,
    required this.sessions28,
    required this.hours28,
    required this.sessionsAll,
    required this.hoursAll,
  });

  final String sport;
  final int sessions28;
  final double hours28;
  final int sessionsAll;
  final double hoursAll;

  factory SportRow.fromJson(Map<String, dynamic> json) => SportRow(
        sport: json['sport'] as String,
        sessions28: (json['sessions28'] as num).toInt(),
        hours28: (json['hours28'] as num).toDouble(),
        sessionsAll: (json['sessionsAll'] as num).toInt(),
        hoursAll: (json['hoursAll'] as num).toDouble(),
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
    required this.seriesLong,
    required this.weekly,
    required this.sports,
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
  final List<LoadPoint> seriesLong;
  final List<WeeklyBucket> weekly;
  final List<SportRow> sports;
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
      seriesLong: ((overview['seriesLong'] ?? overview['series']) as List)
          .map((e) => LoadPoint.fromJson(e as Map<String, dynamic>))
          .toList(),
      weekly: ((overview['weekly'] ?? const []) as List)
          .map((e) => WeeklyBucket.fromJson(e as Map<String, dynamic>))
          .toList(),
      sports: ((overview['sports'] ?? const []) as List)
          .map((e) => SportRow.fromJson(e as Map<String, dynamic>))
          .toList(),
      last28Hours: (last28['hours'] as num).toDouble(),
      last28DeltaPct: (last28['deltaPct'] as num?)?.toDouble(),
      race: race == null ? null : RaceInfo.fromJson(race),
      hasData: overview['hasData'] as bool,
    );
  }
}
