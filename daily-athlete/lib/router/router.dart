import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/auth_notifier.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/auth/sign_up_screen.dart';
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
      final authAsync = ref.read(authNotifierProvider);
      return authAsync.when(
        loading: () => Routes.loading,
        error: (_, __) => Routes.signIn,
        data: (auth) {
          final isSignIn = state.matchedLocation == Routes.signIn;
          final isSignUp = state.matchedLocation == Routes.signUp;
          final isLoading = state.matchedLocation == Routes.loading;
          final isAuthRoute = isSignIn || isSignUp;

          if (auth.isLoading) return Routes.loading;
          if (!auth.isAuthenticated) return isAuthRoute ? null : Routes.signIn;
          if (isAuthRoute || isLoading) return Routes.dashboard;
          return null;
        },
      );
    },
    routes: [
      GoRoute(
        path: Routes.loading,
        builder: (_, __) => const _LoadingScreen(),
      ),
      GoRoute(
        path: Routes.signIn,
        builder: (_, __) => const SignInScreen(),
      ),
      GoRoute(
        path: Routes.signUp,
        builder: (_, __) => const SignUpScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: Routes.dashboard,
            builder: (_, __) => const DashboardTab(),
            routes: [
              GoRoute(
                path: 'athlete/:id',
                builder: (_, state) => DashboardTab(
                  athleteId: state.pathParameters['id'],
                ),
              ),
            ],
          ),
          GoRoute(
            path: Routes.activities,
            builder: (_, __) => const ActivitiesTab(),
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
          GoRoute(
            path: Routes.calendar,
            builder: (_, __) => const CalendarTab(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (_, state) => PlannedWorkoutDetailScreen(
                  workoutId: state.pathParameters['id']!,
                ),
              ),
            ],
          ),
          GoRoute(
            path: Routes.settings,
            builder: (_, __) => const SettingsTab(),
          ),
          GoRoute(
            path: Routes.plans,
            builder: (_, __) => const PlanHistoryScreen(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (_, state) => PlanDetailScreen(
                  planId: state.pathParameters['id']!,
                ),
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
                  final kind = PeriodKind.fromString(state.pathParameters['kind']!);
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

/// Bridges Riverpod auth state to GoRouter's refreshListenable.
/// Extends ChangeNotifier and calls notifyListeners() whenever the
/// watched auth state changes, which triggers GoRouter to re-run redirect.
class RouterNotifier extends ChangeNotifier {
  RouterNotifier(this._ref) {
    _ref.listen(authNotifierProvider, (_, __) => notifyListeners());
  }

  final Ref _ref;
}

class _LoadingScreen extends StatelessWidget {
  const _LoadingScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: CircularProgressIndicator()),
    );
  }
}
