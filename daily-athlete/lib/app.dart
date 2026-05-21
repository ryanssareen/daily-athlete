import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/settings/theme_notifier.dart';
import 'router/router.dart';

/// Root widget. GoRouter handles all routing including auth guards.
/// Theme is driven by ThemeNotifier (persisted), defaulting to light.
class DA2App extends ConsumerWidget {
  const DA2App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    // Drive themeMode from the persisted notifier so the Settings toggle
    // actually takes effect. Default to light until the stored value resolves.
    final themeMode =
        ref.watch(themeNotifierProvider).valueOrNull ?? ThemeMode.light;

    return MaterialApp.router(
      title: 'DA2',
      routerConfig: router,
      theme: _buildTheme(Brightness.light),
      darkTheme: _buildTheme(Brightness.dark),
      themeMode: themeMode,
    );
  }
}

/// Shared theme for light + dark. Brand palette: a vivid red accent (matching
/// the DA logo's red-to-black mark) over clean black/white surfaces. The
/// `vibrant` scheme variant keeps the red saturated as an accent while surfaces
/// stay near-neutral. Modern Material 3 styling: flat tonal cards with large
/// corner radii and left-aligned app bars.
ThemeData _buildTheme(Brightness brightness) {
  final colorScheme = ColorScheme.fromSeed(
    seedColor: const Color(0xFFFF0D17), // brand red (brighter / more saturated)
    brightness: brightness,
    dynamicSchemeVariant: DynamicSchemeVariant.vibrant,
  );
  return ThemeData(
    colorScheme: colorScheme,
    useMaterial3: true,
    appBarTheme: const AppBarTheme(centerTitle: false),
    cardTheme: CardThemeData(
      elevation: 0,
      color: colorScheme.surfaceContainerLow,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
      ),
    ),
  );
}
