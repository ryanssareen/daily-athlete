import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';
import 'distance_format.dart';
import 'units_notifier.dart';

class StravaPeriodTotals {
  const StravaPeriodTotals({
    required this.count,
    required this.distanceM,
    required this.movingSec,
    required this.elevationM,
  });

  final int count;
  final double distanceM;
  final int movingSec;
  final double elevationM;
}

class StravaSportTotals {
  const StravaSportTotals({
    required this.sport,
    required this.recent,
    required this.ytd,
    required this.all,
  });

  /// 'run' | 'ride' | 'swim'
  final String sport;
  final StravaPeriodTotals recent;
  final StravaPeriodTotals ytd;
  final StravaPeriodTotals all;

  String get label => switch (sport) {
        'run' => 'Running',
        'ride' => 'Riding',
        'swim' => 'Swimming',
        _ => sport,
      };
}

StravaPeriodTotals _period(Object? raw) {
  final m = raw is Map ? raw : const {};
  return StravaPeriodTotals(
    count: (m['count'] as num?)?.toInt() ?? 0,
    distanceM: (m['distance'] as num?)?.toDouble() ?? 0,
    movingSec: (m['moving_time'] as num?)?.toInt() ?? 0,
    elevationM: (m['elevation_gain'] as num?)?.toDouble() ?? 0,
  );
}

/// Parses the body of GET /api/integrations/strava/totals. Returns an empty
/// list for anything but a 200 `ok` response. Pure, for unit tests.
List<StravaSportTotals> parseStravaTotalsResponse(int statusCode, String body) {
  if (statusCode != 200) return const [];
  try {
    final json = jsonDecode(body);
    if (json is! Map || json['status'] != 'ok') return const [];
    final raw = json['sports'];
    if (raw is! List) return const [];
    return [
      for (final s in raw)
        if (s is Map && s['sport'] is String)
          StravaSportTotals(
            sport: s['sport'] as String,
            recent: _period(s['recent']),
            ytd: _period(s['ytd']),
            all: _period(s['all']),
          ),
    ];
  } catch (_) {
    return const [];
  }
}

/// Strava totals fetched live when Settings opens; never persisted.
final stravaTotalsProvider =
    FutureProvider.autoDispose<List<StravaSportTotals>>((ref) async {
  final session = Supabase.instance.client.auth.currentSession;
  if (session == null) return const [];
  try {
    final response = await http.get(
      Uri.parse('${Env.apiBaseUrl}/api/integrations/strava/totals'),
      headers: {'Authorization': 'Bearer ${session.accessToken}'},
    ).timeout(const Duration(seconds: 25));
    return parseStravaTotalsResponse(response.statusCode, response.body);
  } catch (e) {
    debugPrint('stravaTotalsProvider: $e');
    return const [];
  }
});

String formatMovingTime(int seconds) {
  final h = seconds ~/ 3600;
  final m = ((seconds % 3600) / 60).round();
  return h > 0 ? '${h}h ${m}m' : '${m}m';
}

/// Compact recent / this-year / all-time table per sport. Renders nothing
/// while loading or when there is no data.
class StravaTotalsView extends ConsumerWidget {
  const StravaTotalsView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sports = ref.watch(stravaTotalsProvider).valueOrNull ?? const [];
    if (sports.isEmpty) return const SizedBox.shrink();
    final unit = ref.watch(unitsNotifierProvider).valueOrNull?.distance ?? 'km';
    final theme = Theme.of(context);

    Widget row(String label, StravaPeriodTotals t) {
      if (t.count == 0) return const SizedBox.shrink();
      return Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Text(
          '$label · ${t.count} activities · ${formatDistanceM(t.distanceM, unit)} · '
          '${formatMovingTime(t.movingSec)}',
          style: theme.textTheme.bodySmall,
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Your Strava totals', style: theme.textTheme.titleSmall),
          for (final s in sports) ...[
            const SizedBox(height: 8),
            Text(
              s.label,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            row('Last 4 weeks', s.recent),
            row('This year', s.ytd),
            row('All time', s.all),
          ],
        ],
      ),
    );
  }
}
