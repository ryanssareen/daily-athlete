import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';

/// One minute of a workout: mean and peak heart rate over that minute.
class HrMinutePoint {
  const HrMinutePoint({required this.minute, required this.avg, required this.max});

  final int minute;
  final int avg;
  final int max;
}

enum HrSeriesStatus { ok, unavailable, rateLimited, reauthRequired, error }

class HrSeriesResult {
  const HrSeriesResult(this.status, [this.points = const []]);

  final HrSeriesStatus status;
  final List<HrMinutePoint> points;
}

/// Parses the body of GET /api/workouts/:id/hr-series for [statusCode].
/// Pure so it can be unit-tested without a network or Flutter binding.
HrSeriesResult parseHrSeriesResponse(int statusCode, String body) {
  switch (statusCode) {
    case 429:
      return const HrSeriesResult(HrSeriesStatus.rateLimited);
    case 401:
      return const HrSeriesResult(HrSeriesStatus.reauthRequired);
    case 200:
      break;
    default:
      return const HrSeriesResult(HrSeriesStatus.error);
  }

  try {
    final json = jsonDecode(body);
    if (json is! Map || json['status'] != 'ok') {
      return const HrSeriesResult(HrSeriesStatus.unavailable);
    }
    final raw = json['points'];
    if (raw is! List) return const HrSeriesResult(HrSeriesStatus.unavailable);
    final points = <HrMinutePoint>[
      for (final p in raw)
        if (p is Map && p['minute'] is num && p['avg'] is num)
          HrMinutePoint(
            minute: (p['minute'] as num).toInt(),
            avg: (p['avg'] as num).round(),
            max: ((p['max'] as num?) ?? (p['avg'] as num)).round(),
          ),
    ];
    if (points.isEmpty) return const HrSeriesResult(HrSeriesStatus.unavailable);
    return HrSeriesResult(HrSeriesStatus.ok, points);
  } catch (_) {
    return const HrSeriesResult(HrSeriesStatus.error);
  }
}

/// Per-minute HR for a Strava workout, fetched live from the server each time
/// the detail screen opens. The server never stores it (Strava ToS), and
/// neither do we: this provider is autoDispose and nothing is written to disk.
final hrSeriesProvider =
    FutureProvider.autoDispose.family<HrSeriesResult, String>((ref, workoutId) async {
  final session = Supabase.instance.client.auth.currentSession;
  if (session == null) return const HrSeriesResult(HrSeriesStatus.unavailable);

  try {
    final response = await http.get(
      Uri.parse('${Env.apiBaseUrl}/api/workouts/$workoutId/hr-series'),
      headers: {'Authorization': 'Bearer ${session.accessToken}'},
    ).timeout(const Duration(seconds: 25));
    return parseHrSeriesResponse(response.statusCode, response.body);
  } catch (e) {
    debugPrint('hrSeriesProvider($workoutId): $e');
    return const HrSeriesResult(HrSeriesStatus.error);
  }
});
