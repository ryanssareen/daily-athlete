import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../router/routes.dart';

/// 4-tab bottom navigation shell. Identical tab bar for both athlete and coach.
/// Tab content widgets are role-aware internally.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.child});

  final Widget child;

  static const _tabs = [
    (path: Routes.dashboard, icon: Icons.dashboard_outlined, activeIcon: Icons.dashboard, label: 'Dashboard'),
    (path: Routes.activities, icon: Icons.directions_run_outlined, activeIcon: Icons.directions_run, label: 'Activities'),
    (path: Routes.calendar, icon: Icons.calendar_month_outlined, activeIcon: Icons.calendar_month, label: 'Calendar'),
    (path: Routes.settings, icon: Icons.settings_outlined, activeIcon: Icons.settings, label: 'Settings'),
  ];

  int _selectedIndex(String location) {
    for (var i = 0; i < _tabs.length; i++) {
      if (location.startsWith(_tabs[i].path)) return i;
    }
    return 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final location = GoRouterState.of(context).matchedLocation;
    final selectedIndex = _selectedIndex(location);

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: selectedIndex,
        onDestinationSelected: (i) => context.go(_tabs[i].path),
        destinations: _tabs
            .map(
              (t) => NavigationDestination(
                icon: Icon(t.icon),
                selectedIcon: Icon(t.activeIcon),
                label: t.label,
              ),
            )
            .toList(),
      ),
    );
  }
}
