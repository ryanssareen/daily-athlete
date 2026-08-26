// lib/features/reports/reports_api.dart
//
// GET /api/reviews (list), GET/POST /api/reviews/:kind/:periodKey (one
// period). GET never calls the LLM; POST generates or regenerates the
// narration. Thin network layer only — mirrors
// ../activities/use_workout_report.dart's shape, with one difference: the
// POST here can legitimately return a non-200 the caller must interpret
// (429 rate-limited, see the route's GENERATION_MAX_PER_WINDOW guard), so
// [generatePeriodReview] hands back the raw status + parsed body instead of
// throwing on anything but 200. reports_view.dart's
// interpretGenerateResponse is what turns that pair into a UI phase — same
// split as review-view.ts on the web.

import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';
import '../../models/period_review.dart';

class ReportsApiError implements Exception {
  ReportsApiError(this.message);
  final String message;
}

Map<String, String> _headers(String token) => {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
    };

String _requireAccessToken() {
  final session = Supabase.instance.client.auth.currentSession;
  if (session == null) throw ReportsApiError('Not authenticated');
  return session.accessToken;
}

/// GET /api/reviews — the athlete's recent weekly + monthly periods.
Future<List<PeriodReviewSummary>> fetchPeriodReviewList() async {
  final token = _requireAccessToken();
  final uri = Uri.parse('${Env.apiBaseUrl}/api/reviews');
  final response = await http.get(uri, headers: _headers(token));
  if (response.statusCode != 200) {
    throw ReportsApiError('Failed to load reports (${response.statusCode})');
  }
  final body = jsonDecode(response.body) as Map<String, dynamic>;
  final periods = body['periods'] as List;
  return periods.map((e) => PeriodReviewSummary.fromJson(e as Map<String, dynamic>)).toList();
}

/// GET /api/reviews/:kind/:periodKey — the facts (always present) plus
/// whatever narration is already stored. Throws on any non-200; callers show
/// a load-failed state, same convention as fetchWorkoutReport.
Future<PeriodReviewResponse> fetchPeriodReview(PeriodKind kind, String periodKey) async {
  final token = _requireAccessToken();
  final uri = Uri.parse('${Env.apiBaseUrl}/api/reviews/${kind.name}/$periodKey');
  final response = await http.get(uri, headers: _headers(token));
  if (response.statusCode != 200) {
    throw ReportsApiError('Failed to load period review (${response.statusCode})');
  }
  return PeriodReviewResponse.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
}

/// The raw result of a POST — status code plus whatever body could be
/// decoded as a [PeriodReviewResponse]. Deliberately NOT throwing on a
/// non-200 here: 429 (rate limited) and a modeled generation failure (still
/// 200, `narration: null`) are both meaningful outcomes the UI must
/// distinguish, and interpretGenerateResponse is what does that — see its
/// doc comment in reports_view.dart for why HTTP status alone is not the
/// success signal.
typedef GenerateResult = ({int statusCode, PeriodReviewResponse? body});

/// POST /api/reviews/:kind/:periodKey — generate or regenerate the
/// narration. Only throws on a transport-level failure; a modeled failure
/// (rate limit, invalid LLM output, transient backoff) comes back as a
/// normal [GenerateResult] for the caller to interpret.
Future<GenerateResult> generatePeriodReview(PeriodKind kind, String periodKey) async {
  final token = _requireAccessToken();
  final uri = Uri.parse('${Env.apiBaseUrl}/api/reviews/${kind.name}/$periodKey');
  final response = await http.post(uri, headers: _headers(token));

  Map<String, dynamic>? decoded;
  try {
    decoded = jsonDecode(response.body) as Map<String, dynamic>;
  } catch (_) {
    decoded = null;
  }

  PeriodReviewResponse? body;
  if (decoded != null && decoded.containsKey('facts')) {
    body = PeriodReviewResponse.fromJson(decoded);
  }

  return (statusCode: response.statusCode, body: body);
}
