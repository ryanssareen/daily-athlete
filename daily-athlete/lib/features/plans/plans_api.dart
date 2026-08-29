// lib/features/plans/plans_api.dart
//
// GET /api/plans (list), GET /api/plans/:id (one plan). Thin network layer
// only, same shape as ../reports/reports_api.dart.

import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';
import '../../models/plan.dart';

class PlansApiError implements Exception {
  PlansApiError(this.message);
  final String message;
}

Map<String, String> _headers(String token) => {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
    };

String _requireAccessToken() {
  final session = Supabase.instance.client.auth.currentSession;
  if (session == null) throw PlansApiError('Not authenticated');
  return session.accessToken;
}

/// GET /api/plans — the athlete's plan history (active + archived), newest
/// first.
Future<List<PlanRow>> fetchPlanList() async {
  final token = _requireAccessToken();
  final uri = Uri.parse('${Env.apiBaseUrl}/api/plans');
  final response = await http.get(uri, headers: _headers(token));
  if (response.statusCode != 200) {
    throw PlansApiError('Failed to load plans (${response.statusCode})');
  }
  final body = jsonDecode(response.body) as Map<String, dynamic>;
  final plans = body['plans'] as List;
  return plans.map((e) => PlanRow.fromJson(e as Map<String, dynamic>)).toList();
}

/// GET /api/plans/:id — a single plan's detail. Throws [PlansApiError] on a
/// 404 (not found, or not owned by this athlete — indistinguishable by
/// design) and on any other non-200.
Future<PlanRow> fetchPlan(String id) async {
  final token = _requireAccessToken();
  final uri = Uri.parse('${Env.apiBaseUrl}/api/plans/$id');
  final response = await http.get(uri, headers: _headers(token));
  if (response.statusCode != 200) {
    throw PlansApiError('Failed to load plan (${response.statusCode})');
  }
  final body = jsonDecode(response.body) as Map<String, dynamic>;
  return PlanRow.fromJson(body['plan'] as Map<String, dynamic>);
}
