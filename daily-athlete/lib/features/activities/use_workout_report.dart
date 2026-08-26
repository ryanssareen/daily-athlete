// lib/features/activities/use_workout_report.dart
//
// GET/POST /api/workouts/[id]/report. GET never calls the LLM (fast, cheap);
// POST generates or regenerates the narrative. Thin network layer only —
// state-transition logic lives in report_view.dart's ReportViewState so it's
// testable without a widget, same split as the web's ReportSection.tsx.

import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';
import '../../models/workout_report.dart';

class ReportApiError implements Exception {
  ReportApiError(this.message);
  final String message;
}

Map<String, String> _headers(String token) => {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
    };

String _requireAccessToken() {
  final session = Supabase.instance.client.auth.currentSession;
  if (session == null) throw ReportApiError('Not authenticated');
  return session.accessToken;
}

/// GET — the initial (or refetched) report. Throws [ReportApiError] on any
/// non-200 or transport failure; callers show a load-failed state.
Future<WorkoutReportResponse> fetchWorkoutReport(String workoutId) async {
  final token = _requireAccessToken();
  final uri = Uri.parse('${Env.apiBaseUrl}/api/workouts/$workoutId/report');
  final response = await http.get(uri, headers: _headers(token));
  if (response.statusCode != 200) {
    throw ReportApiError('Failed to load report (${response.statusCode})');
  }
  return WorkoutReportResponse.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
}

/// POST — generate or regenerate the narrative. Still returns 200 with
/// `narration: null` on a modeled LLM failure (see WorkoutReportResponse's
/// `retryable`); this only throws on transport-level failure.
Future<WorkoutReportResponse> generateWorkoutReport(String workoutId) async {
  final token = _requireAccessToken();
  final uri = Uri.parse('${Env.apiBaseUrl}/api/workouts/$workoutId/report');
  final response = await http.post(uri, headers: _headers(token));
  if (response.statusCode != 200) {
    throw ReportApiError('generate failed: ${response.statusCode}');
  }
  return WorkoutReportResponse.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
}
