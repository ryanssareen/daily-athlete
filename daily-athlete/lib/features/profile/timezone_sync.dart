import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';
import '../auth/auth_notifier.dart';

/// Pure decision behind the self-heal; mirrors shouldSyncTimezone in
/// apps/web/src/components/timezone-sync.tsx.
bool shouldSyncTimezone(String? detected, String? current) {
  return detected != null && detected.isNotEmpty && detected != current;
}

/// Compares the device's IANA zone with the stored one and PATCHes on
/// mismatch. Best-effort: any failure is swallowed — the next launch retries
/// and nothing on screen depends on it. Dependencies are injected for tests.
Future<void> syncTimezoneIfNeeded({
  required Future<String?> Function() detect,
  required Future<String?> Function() fetchStored,
  required Future<void> Function(String timezone) patch,
}) async {
  try {
    final detected = await detect();
    if (detected == null || detected.isEmpty) return;
    final stored = await fetchStored();
    if (!shouldSyncTimezone(detected, stored)) return;
    await patch(detected);
  } catch (_) {
    // Intentionally silent; see doc comment.
  }
}

/// Runs [syncTimezoneIfNeeded] against the real device, Supabase and
/// PATCH /api/profile/timezone (Bearer auth).
Future<void> syncDeviceTimezone(String userId) {
  final supabase = Supabase.instance.client;
  return syncTimezoneIfNeeded(
    detect: () async => (await FlutterTimezone.getLocalTimezone()).identifier,
    fetchStored: () async {
      final row = await supabase
          .from('users')
          .select('timezone')
          .eq('id', userId)
          .maybeSingle();
      return row?['timezone'] as String?;
    },
    patch: (timezone) async {
      final session = supabase.auth.currentSession;
      if (session == null) return;
      final response = await http.patch(
        Uri.parse('${Env.apiBaseUrl}/api/profile/timezone'),
        headers: {
          'Authorization': 'Bearer ${session.accessToken}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({'timezone': timezone}),
      );
      if (response.statusCode >= 300) {
        throw StateError('timezone sync failed (${response.statusCode})');
      }
    },
  );
}

/// Seam so tests can observe the provider without touching Supabase.
final timezoneSyncRunnerProvider =
    Provider<Future<void> Function(String userId)>((ref) => syncDeviceTimezone);

/// Fires once per signed-in user (keyed on user id, so token refreshes don't
/// re-run it). Watched from DA2App.
final timezoneSyncProvider = FutureProvider<void>((ref) async {
  final userId = await ref.watch(
    authNotifierProvider.selectAsync((s) => s.isAuthenticated ? s.userId : null),
  );
  if (userId == null) return;
  await ref.read(timezoneSyncRunnerProvider)(userId);
});
