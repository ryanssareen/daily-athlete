import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'athlete_dashboard.dart';

/// Standalone screen for a coach viewing a specific athlete's dashboard.
///
/// Navigation path: /dashboard/athlete/:id
///
/// The GoRouter in router.dart routes /dashboard/athlete/:id through
/// [DashboardTab] with [athleteId] set, which internally renders
/// [AthleteDashboard].  This class provides an equivalent standalone widget
/// when a full-page push outside the shell route is needed (e.g., deep-links
/// or future notification taps).
///
/// [AthleteDashboard] renders its own [Scaffold] + [AppBar], so this widget
/// acts as a routing entry-point with correct back-navigation.
class AthleteDetailScreen extends StatelessWidget {
  const AthleteDetailScreen({super.key, required this.athleteId});

  final String athleteId;

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        if (context.canPop()) {
          context.pop();
        } else {
          context.go('/dashboard');
        }
      },
      child: AthleteDashboard(athleteId: athleteId),
    );
  }
}
