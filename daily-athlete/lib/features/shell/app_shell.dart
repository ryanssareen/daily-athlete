import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/layout.dart';
import '../../router/routes.dart';

/// 5-tab bottom navigation shell (Home, Activities, Calendar, Plan, Reports).
/// Settings opens from the avatar button on Home.
/// Identical tab bar for both athlete and coach.
/// Tab content widgets are role-aware internally.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.child});

  final Widget child;

  static const _tabs = [
    (
      path: Routes.dashboard,
      icon: Icons.dashboard_outlined,
      activeIcon: Icons.dashboard,
      label: 'Home',
    ),
    (
      path: Routes.activities,
      icon: Icons.directions_run_outlined,
      activeIcon: Icons.directions_run,
      label: 'Activities',
    ),
    (
      path: Routes.calendar,
      icon: Icons.calendar_month_outlined,
      activeIcon: Icons.calendar_month,
      label: 'Calendar',
    ),
    (
      path: Routes.plans,
      icon: Icons.event_note_outlined,
      activeIcon: Icons.event_note,
      label: 'Plan',
    ),
    (
      path: Routes.reports,
      icon: Icons.insert_chart_outlined,
      activeIcon: Icons.insert_chart,
      label: 'Reports',
    ),
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
    final layout = context.layout;

    if (layout != LayoutSize.compact) {
      return _SideNavShell(
        extended: layout == LayoutSize.expanded,
        selectedIndex: selectedIndex,
        onSelect: (i) => context.go(_tabs[i].path),
        child: child,
      );
    }

    return Scaffold(
      body: child,
      bottomNavigationBar: MediaQuery.withClampedTextScaling(
        maxScaleFactor: 1.2,
        child: NavigationBar(
          backgroundColor: Theme.of(context).colorScheme.surfaceContainer,
          indicatorColor: Theme.of(context).colorScheme.primaryContainer,
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
      ),
    );
  }
}

/// Tablet shell: a NavigationRail on medium widths, an extended sidebar with
/// labels on expanded widths.
class _SideNavShell extends StatelessWidget {
  const _SideNavShell({
    required this.extended,
    required this.selectedIndex,
    required this.onSelect,
    required this.child,
  });

  final bool extended;
  final int selectedIndex;
  final ValueChanged<int> onSelect;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: Row(
        children: [
          MediaQuery.withClampedTextScaling(
            maxScaleFactor: 1.2,
            child: Container(
              color: scheme.surfaceContainer,
              child: SafeArea(
                right: false,
                child: NavigationRail(
                  extended: extended,
                  minExtendedWidth: 248,
                  backgroundColor: scheme.surfaceContainer,
                  indicatorColor: scheme.primaryContainer,
                  selectedIndex: selectedIndex,
                  onDestinationSelected: onSelect,
                  labelType: extended
                      ? NavigationRailLabelType.none
                      : NavigationRailLabelType.all,
                  leading: extended
                      ? const _Brand()
                      : const SizedBox(height: 8),
                  destinations: AppShell._tabs
                      .map(
                        (t) => NavigationRailDestination(
                          icon: Icon(t.icon),
                          selectedIcon: Icon(t.activeIcon),
                          label: Text(t.label),
                        ),
                      )
                      .toList(),
                ),
              ),
            ),
          ),
          VerticalDivider(width: 1, thickness: 1, color: scheme.outlineVariant),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class _Brand extends StatelessWidget {
  const _Brand();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 12, 8, 24),
      child: SizedBox(
        width: 200,
        child: Text(
          'Daily Athlete',
          style: theme.textTheme.titleLarge?.copyWith(
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
