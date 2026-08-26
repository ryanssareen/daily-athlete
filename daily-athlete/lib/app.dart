import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/settings/theme_notifier.dart';
import 'router/router.dart';

/// Root widget. GoRouter handles all routing including auth guards.
/// Theme starts as system default; Settings tab overrides via ThemeNotifier.
class DA2App extends ConsumerWidget {
  const DA2App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final themeMode = ref.watch(themeNotifierProvider).valueOrNull ?? ThemeMode.system;

    return MaterialApp.router(
      title: 'DA2',
      routerConfig: router,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFC0392B), // pomegranate red
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFC0392B),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      themeMode: themeMode,
    );
  }
}
