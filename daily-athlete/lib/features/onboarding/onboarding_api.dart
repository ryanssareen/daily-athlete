import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../auth/auth_notifier.dart';

/// Whether the signed-in user has finished first-run onboarding.
///
/// Source of truth is `athlete_profiles.manual_fields.onboarded_at`, the same
/// flag the web app gates on (see apps/web/app/(athlete)/layout.tsx), so a
/// user who onboarded on either surface is never asked again.
///
/// A failed read counts as "done": a network blip must not trap an existing
/// user behind a setup screen.
final onboardingCompleteProvider = FutureProvider<bool>((ref) async {
  final auth = await ref.watch(authNotifierProvider.future);
  final userId = auth.userId;
  if (!auth.isAuthenticated || userId == null) return true;
  try {
    final row = await Supabase.instance.client
        .from('athlete_profiles')
        .select('manual_fields')
        .eq('user_id', userId)
        .maybeSingle();
    final fields = (row?['manual_fields'] as Map?) ?? const {};
    return fields['onboarded_at'] is String;
  } catch (_) {
    return true;
  }
});

class OnboardingAnswers {
  const OnboardingAnswers({
    this.nickname = '',
    this.primarySport = 'tri',
    this.weeklyHours = 8,
    this.trainingPattern = 'Even split',
    this.eventType,
    this.eventDate,
  });

  final String nickname;
  final String primarySport;
  final int weeklyHours;
  final String trainingPattern;
  final String? eventType;
  final DateTime? eventDate;
}

/// Merges [answers] into an existing `manual_fields` blob, matching what
/// POST /api/onboarding/save writes for the web flow. Pure for testing.
Map<String, dynamic> mergeManualFields(
  Map<String, dynamic> existing,
  OnboardingAnswers answers, {
  required DateTime now,
}) {
  final merged = Map<String, dynamic>.from(existing)
    ..['primary_sport'] = answers.primarySport
    ..['weekly_hours_avail'] = answers.weeklyHours
    ..['training_pattern'] = answers.trainingPattern
    ..['onboarded_at'] = now.toUtc().toIso8601String();
  final type = answers.eventType;
  final date = answers.eventDate;
  if (type != null && date != null) {
    final mm = date.month.toString().padLeft(2, '0');
    final dd = date.day.toString().padLeft(2, '0');
    merged['target_event'] = {'type': type, 'date': '${date.year}-$mm-$dd'};
  } else {
    merged.remove('target_event');
  }
  return merged;
}

/// Writes onboarding answers straight to Supabase under the user's JWT; RLS
/// (users_self_update, athlete_profiles_self_insert/_update) scopes the rows.
/// The web route can't be used because it only accepts cookie sessions and
/// the mobile app authenticates with a bearer token.
Future<void> saveOnboarding(String userId, OnboardingAnswers answers) async {
  final supabase = Supabase.instance.client;

  final nickname = answers.nickname.trim();
  if (nickname.isNotEmpty) {
    await supabase
        .from('users')
        .update({'display_name': nickname})
        .eq('id', userId);
  }

  final existing = await supabase
      .from('athlete_profiles')
      .select('manual_fields')
      .eq('user_id', userId)
      .maybeSingle();
  final merged = mergeManualFields(
    Map<String, dynamic>.from((existing?['manual_fields'] as Map?) ?? const {}),
    answers,
    now: DateTime.now(),
  );
  await supabase.from('athlete_profiles').upsert({
    'user_id': userId,
    'manual_fields': merged,
  }, onConflict: 'user_id');
}
