import 'package:flutter/material.dart';

import 'da_theme.dart';

const ColorScheme _lightScheme = ColorScheme(
  brightness: Brightness.light,
  primary: Color(0xFFA4451F),
  onPrimary: Color(0xFFFFFFFF),
  primaryContainer: Color(0xFFF6E0D2),
  onPrimaryContainer: Color(0xFFA4451F),
  secondary: Color(0xFF2D4A3E),
  onSecondary: Color(0xFFFFFFFF),
  secondaryContainer: Color(0xFFD9E4DD),
  onSecondaryContainer: Color(0xFF2D4A3E),
  tertiary: Color(0xFF5B554A),
  onTertiary: Color(0xFFFFFFFF),
  tertiaryContainer: Color(0xFFF1EBDE),
  onTertiaryContainer: Color(0xFF14110D),
  error: Color(0xFFC4423A),
  onError: Color(0xFFFFFFFF),
  errorContainer: Color(0xFFF3D9D2),
  onErrorContainer: Color(0xFF14110D),
  surface: Color(0xFFF8F3EA),
  onSurface: Color(0xFF14110D),
  onSurfaceVariant: Color(0xFF5B554A),
  surfaceContainerLowest: Color(0xFFFFFFFF),
  surfaceContainerLow: Color(0xFFFFFFFF),
  surfaceContainer: Color(0xFFF1EBDE),
  surfaceContainerHigh: Color(0xFFF1EBDE),
  surfaceContainerHighest: Color(0xFFE5DCC7),
  outline: Color(0xFF8A8478),
  outlineVariant: Color(0xFFE5DCC7),
  inverseSurface: Color(0xFF14110D),
  onInverseSurface: Color(0xFFF8F3EA),
  inversePrimary: Color(0xFFC45A30),
);

const ColorScheme _darkScheme = ColorScheme(
  brightness: Brightness.dark,
  primary: Color(0xFFC45A30),
  onPrimary: Color(0xFF111009),
  primaryContainer: Color(0xFFA4451F),
  onPrimaryContainer: Color(0xFFF6E0D2),
  secondary: Color(0xFFD9E4DD),
  onSecondary: Color(0xFF2D4A3E),
  secondaryContainer: Color(0xFF2D4A3E),
  onSecondaryContainer: Color(0xFFD9E4DD),
  tertiary: Color(0xFFA09890),
  onTertiary: Color(0xFF111009),
  tertiaryContainer: Color(0xFF18160F),
  onTertiaryContainer: Color(0xFFF0ECE3),
  error: Color(0xFFC4423A),
  onError: Color(0xFFFFFFFF),
  errorContainer: Color(0xFF3A1F1B),
  onErrorContainer: Color(0xFFF0ECE3),
  surface: Color(0xFF111009),
  onSurface: Color(0xFFF0ECE3),
  onSurfaceVariant: Color(0xFFA09890),
  surfaceContainerLowest: Color(0xFF111009),
  surfaceContainerLow: Color(0xFF1E1C14),
  surfaceContainer: Color(0xFF18160F),
  surfaceContainerHigh: Color(0xFF2B2820),
  surfaceContainerHighest: Color(0xFF3A3628),
  outline: Color(0xFF655F58),
  outlineVariant: Color(0xFF2B2820),
  inverseSurface: Color(0xFFF0ECE3),
  onInverseSurface: Color(0xFF111009),
  inversePrimary: Color(0xFFA4451F),
);

TextTheme _textTheme(TextTheme base) {
  return base.copyWith(
    headlineMedium: base.headlineMedium?.copyWith(
      fontSize: 28,
      height: 34 / 28,
      fontWeight: FontWeight.w600,
      letterSpacing: -0.56,
    ),
    titleMedium: base.titleMedium?.copyWith(
      fontSize: 16,
      height: 22 / 16,
      fontWeight: FontWeight.w600,
    ),
    bodyMedium: base.bodyMedium?.copyWith(fontSize: 15, height: 20 / 15),
    bodySmall: base.bodySmall?.copyWith(fontSize: 13, height: 18 / 13),
    labelMedium: base.labelMedium?.copyWith(
      fontSize: 12,
      height: 16 / 12,
      fontWeight: FontWeight.w500,
    ),
  );
}

ThemeData _build(ColorScheme scheme, {required Color clay, required Color outlineStrong}) {
  final base = ThemeData(brightness: scheme.brightness, fontFamily: 'Geist');
  return ThemeData(
    extensions: [DaTheme.build(clay: clay, outlineStrong: outlineStrong)],
    textTheme: _textTheme(base.textTheme),
    colorScheme: scheme,
    fontFamily: 'Geist',
    scaffoldBackgroundColor: scheme.surface,
    useMaterial3: true,
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: scheme.inverseSurface,
        foregroundColor: scheme.onInverseSurface,
        shape: const StadiumBorder(),
        minimumSize: const Size(0, 44),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        side: BorderSide(color: outlineStrong),
        shape: const StadiumBorder(),
        minimumSize: const Size(0, 44),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: scheme.primary,
        shape: const StadiumBorder(),
        minimumSize: const Size(0, 44),
      ),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        side: WidgetStatePropertyAll(BorderSide(color: outlineStrong)),
        shape: const WidgetStatePropertyAll(StadiumBorder()),
        backgroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? scheme.primaryContainer : null,
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? scheme.onPrimaryContainer : scheme.onSurface,
        ),
      ),
    ),
    cardTheme: CardThemeData(
      color: scheme.surfaceContainerLow,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: scheme.outlineVariant),
      ),
    ),
  );
}

final ThemeData lightTheme = _build(
  _lightScheme,
  clay: const Color(0xFFC45A30),
  outlineStrong: const Color(0xFFD6C9AD),
);
final ThemeData darkTheme = _build(
  _darkScheme,
  clay: const Color(0xFFC45A30),
  outlineStrong: const Color(0xFF3A3628),
);
