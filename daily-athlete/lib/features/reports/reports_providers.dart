// lib/features/reports/reports_providers.dart
//
// Riverpod providers for the Reports tab, matching this codebase's
// AsyncNotifier.family convention (see
// ../dashboard/dashboard_providers.dart's athleteDashboardProvider and
// ../activities/workout_detail_provider.dart). Network calls live in
// reports_api.dart; the generate/regenerate state machine lives in
// reports_view.dart — this file only wires the two together.

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/period_review.dart';
import 'reports_api.dart';
import 'reports_view.dart';

/// GET /api/reviews — the recent-periods list for the Reports list screen.
final periodReviewListProvider =
    FutureProvider.autoDispose<List<PeriodReviewSummary>>((ref) async {
  return fetchPeriodReviewList();
});

/// Identifies one period for [periodReviewProvider]. A record rather than a
/// composite string key so callers can't accidentally build an ill-formed
/// "kind:key" and have it silently mismatch.
typedef PeriodReviewArgs = ({PeriodKind kind, String periodKey});

/// The detail screen's full state: the last-fetched/generated response, plus
/// where a generate/regenerate attempt currently stands. [phase] is
/// [GeneratePhase.idle] both before any attempt and after one succeeds —
/// same "idle also means done" convention as review-detail.tsx's `Phase`.
class PeriodReviewViewState {
  const PeriodReviewViewState({required this.response, required this.phase});

  final PeriodReviewResponse response;
  final GeneratePhase phase;

  PeriodReviewViewState copyWith({PeriodReviewResponse? response, GeneratePhase? phase}) =>
      PeriodReviewViewState(
        response: response ?? this.response,
        phase: phase ?? this.phase,
      );
}

class PeriodReviewNotifier
    extends AutoDisposeFamilyAsyncNotifier<PeriodReviewViewState, PeriodReviewArgs> {
  @override
  Future<PeriodReviewViewState> build(PeriodReviewArgs args) async {
    final response = await fetchPeriodReview(args.kind, args.periodKey);
    return PeriodReviewViewState(response: response, phase: GeneratePhase.idle);
  }

  /// Generate or regenerate the narration. Optimistically flips [phase] to
  /// `generating` (the facts stay on screen unconditionally — only the
  /// narration area reacts), then adopts the server's outcome via
  /// [interpretGenerateResponse]. Never rethrows: a transport failure lands
  /// as [GeneratePhase.error] on the existing state rather than blanking the
  /// facts the athlete is already looking at.
  Future<void> generate() async {
    final current = state.valueOrNull;
    if (current == null) return;
    final args = arg;

    state = AsyncData(current.copyWith(phase: GeneratePhase.generating));
    try {
      final result = await generatePeriodReview(args.kind, args.periodKey);
      final outcome = interpretGenerateResponse(result.statusCode, result.body);
      if (outcome.phase == GeneratePhase.idle && result.body != null) {
        state = AsyncData(PeriodReviewViewState(response: result.body!, phase: GeneratePhase.idle));
      } else {
        state = AsyncData(current.copyWith(phase: outcome.phase));
      }
    } catch (_) {
      state = AsyncData(current.copyWith(phase: GeneratePhase.error));
    }
  }
}

final periodReviewProvider = AsyncNotifierProvider.autoDispose
    .family<PeriodReviewNotifier, PeriodReviewViewState, PeriodReviewArgs>(
  PeriodReviewNotifier.new,
);
