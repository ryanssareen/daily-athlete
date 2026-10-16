import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';
import '../../models/athlete_overview.dart';

/// GET /api/athlete/overview. Throws on any non-200 so callers can fall back.
Future<AthleteOverview> fetchAthleteOverview() async {
  final session = Supabase.instance.client.auth.currentSession;
  if (session == null) throw StateError('Not authenticated');
  final response = await http.get(
    Uri.parse('${Env.apiBaseUrl}/api/athlete/overview'),
    headers: {'Authorization': 'Bearer ${session.accessToken}'},
  );
  if (response.statusCode != 200) {
    throw StateError('Overview failed (${response.statusCode})');
  }
  return AthleteOverview.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
}

/// Null when the endpoint is unavailable; Home hides the Form card and uses a
/// device-clock greeting instead of failing.
final athleteOverviewProvider = FutureProvider.autoDispose<AthleteOverview?>((ref) async {
  try {
    return await fetchAthleteOverview();
  } catch (_) {
    return null;
  }
});
