import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/layout.dart';
import '../features/auth/auth_notifier.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/auth/sign_up_screen.dart';
import '../features/onboarding/onboarding_api.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/shell/role_notifier.dart';
import '../models/user.dart' show RoleFlag;
import '../features/shell/app_shell.dart';
import '../features/dashboard/dashboard_tab.dart';
import '../features/activities/activities_tab.dart';
import '../features/activities/activity_detail_screen.dart';
import '../features/calendar/calendar_tab.dart';
import '../features/calendar/planned_workout_detail_screen.dart';
import '../features/plans/plan_detail_screen.dart';
import '../features/plans/plan_history_screen.dart';
import '../features/reports/report_detail_screen.dart';
import '../features/reports/reports_list_screen.dart';
import '../features/settings/settings_tab.dart';
import '../features/shared/list_detail_split.dart';
import '../models/period_review.dart';
import 'routes.dart';

final routerProvider = Provider<GoRouter>((ref) {
  // RouterNotifier bridges Riverpod auth state to GoRouter's refreshListenable.
  // Without this wiring, the router redirect guard does not re-evaluate after
  // login/logout, leaving the app on the wrong route.
  final notifier = RouterNotifier(ref);

  return GoRouter(
    initialLocation: Routes.loading,
    refreshListenable: notifier,
    redirect: (context, state) {
      if (state.uri.scheme == 'da2') {
        return state.uri.host == 'strava-oauth'
            ? Routes.settings
            : Routes.loading;
      }
      final authAsync = ref.read(authNotifierProvider);
      return authAsync.when(
        loading: () => Routes.loading,
        error: (_, __) => Routes.signIn,
        data: (auth) {
          final isSignIn = state.matchedLocation == Routes.signIn;
          final isSignUp = state.matchedLocation == Routes.signUp;
          final isLoading = state.matchedLocation == Routes.loading;
          final isAuthRoute = isSignIn || isSignUp;

          final isOnboarding = state.matchedLocation == Routes.onboarding;

          if (auth.isLoading) return Routes.loading;
          if (!auth.isAuthenticated) return isAuthRoute ? null : Routes.signIn;

          // First-run gate: athletes who haven't finished setup go to
          // onboarding. Coaches skip it; a failed role lookup also skips so
          // nobody is trapped. `null` means the answer isn't known yet.
          final needsOnboarding = _needsOnboarding(ref);
          if (needsOnboarding == null) return isLoading ? null : Routes.loading;
          if (needsOnboarding) return isOnboarding ? null : Routes.onboarding;
          if (isAuthRoute || isLoading || isOnboarding) return Routes.dashboard;
          return null;
        },
      );
    },
    routes: [
      GoRoute(path: '/', redirect: (_, __) => Routes.dashboard),
      GoRoute(path: Routes.loading, builder: (_, __) => const _LoadingScreen()),
      GoRoute(path: Routes.signIn, builder: (_, __) => const SignInScreen()),
      GoRoute(path: Routes.signUp, builder: (_, __) => const SignUpScreen()),
      GoRoute(
        path: Routes.onboarding,
        builder: (_, __) => const OnboardingScreen(),
      ),
      GoRoute(path: Routes.settings, builder: (_, __) => const SettingsTab()),
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: Routes.dashboard,
            builder: (_, __) => const DashboardTab(),
            routes: [
              GoRoute(
                path: 'athlete/:id',
                builder: (_, state) =>
                    DashboardTab(athleteId: state.pathParameters['id']),
              ),
            ],
          ),
          ShellRoute(
            builder: (_, _, child) => ListDetailSplit(
              master: const ActivitiesTab(),
              masterWidth: 380,
              detail: child,
            ),
            routes: [
              GoRoute(
                path: Routes.activities,
                builder: (context, _) => context.layout == LayoutSize.expanded
                    ? const DetailPlaceholder(
                        icon: Icons.directions_run_outlined,
                        message: 'Select an activity to see its details.',
                      )
                    : const ActivitiesTab(),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (_, state) {
                      final id = state.pathParameters['id']!;
                      final from =
                          state.uri.queryParameters['from'] ?? 'activities';
                      return ActivityDetailScreen(workoutId: id, from: from);
                    },
                  ),
                ],
              ),
            ],
          ),
          ShellRoute(
            builder: (_, state, child) => ListDetailSplit(
              master: const CalendarTab(),
              detailWidth: 340,
              showDetail: state.uri.path != Routes.calendar,
              detail: child,
            ),
            routes: [
              GoRoute(
                path: Routes.calendar,
                builder: (context, _) => context.layout == LayoutSize.expanded
                    ? const DetailPlaceholder(
                        icon: Icons.event_outlined,
                        message: 'Tap a workout to see it here.',
                      )
                    : const CalendarTab(),
                routes: [
                  GoRoute(
                    path: ':id',
                    builder: (_, state) => PlannedWorkoutDetailScreen(
                      workoutId: state.pathParameters['id']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          GoRoute(
            path: Routes.plans,
            builder: (_, __) => const PlanHistoryScreen(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (_, state) =>
                    PlanDetailScreen(planId: state.pathParameters['id']!),
              ),
            ],
          ),
          GoRoute(
            path: Routes.reports,
            builder: (_, __) => const ReportsListScreen(),
            routes: [
              GoRoute(
                path: ':kind/:periodKey',
                builder: (_, state) {
                  final kind = PeriodKind.fromString(
                    state.pathParameters['kind']!,
                  );
                  final periodKey = state.pathParameters['periodKey']!;
                  return ReportDetailScreen(kind: kind, periodKey: periodKey);
                },
              ),
            ],
          ),
        ],
      ),
    ],
  );
});

/// Whether the signed-in user must complete onboarding first, or `null` while
/// the role / onboarding lookups are still resolving for the first time.
bool? _needsOnboarding(Ref ref) {
  final role = ref.read(roleNotifierProvider);
  if (!role.hasValue && !role.hasError) return null;
  if (role.valueOrNull == RoleFlag.coach) return false;

  final done = ref.read(onboardingCompleteProvider);
  if (!done.hasValue && !done.hasError) return null;
  return done.valueOrNull == false;
}

/// Bridges Riverpod auth state to GoRouter's refreshListenable.
/// Extends ChangeNotifier and calls notifyListeners() whenever the
/// watched auth state changes, which triggers GoRouter to re-run redirect.
class RouterNotifier extends ChangeNotifier {
  RouterNotifier(this._ref) {
    _ref.listen(authNotifierProvider, (_, __) => notifyListeners());
    _ref.listen(roleNotifierProvider, (_, __) => notifyListeners());
    _ref.listen(onboardingCompleteProvider, (_, __) => notifyListeners());
  }

  final Ref _ref;
}

class _LoadingScreen extends StatelessWidget {
  const _LoadingScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}
