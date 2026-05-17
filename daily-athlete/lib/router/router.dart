import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/auth_notifier.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/shell/app_shell.dart';
import '../features/dashboard/dashboard_tab.dart';
import '../features/activities/activities_tab.dart';
import '../features/calendar/calendar_tab.dart';
import '../features/settings/settings_tab.dart';
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
          final isLoading = state.matchedLocation == Routes.loading;

          if (auth.isLoading) return Routes.loading;
          if (!auth.isAuthenticated) return isSignIn ? null : Routes.signIn;
          if (isSignIn || isLoading) return Routes.dashboard;
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
                builder: (_, state) => ActivitiesTab(
                  activityId: state.pathParameters['id'],
                ),
              ),
            ],
          ),
          GoRoute(
            path: Routes.calendar,
            builder: (_, __) => const CalendarTab(),
          ),
          GoRoute(
            path: Routes.settings,
            builder: (_, __) => const SettingsTab(),
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
