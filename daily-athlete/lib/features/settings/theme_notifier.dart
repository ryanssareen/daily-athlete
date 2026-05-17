// ThemeNotifier — persists the user's theme preference across app restarts.
//
// Storage key: 'da2.theme' in flutter_secure_storage.
// Values: 'system' | 'light' | 'dark'
//
// On first launch (no stored value) defaults to ThemeMode.system.
// MaterialApp reads themeMode from this notifier via Watch.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

const _kThemeKey = 'da2.theme';

ThemeMode _decode(String? value) {
  switch (value) {
    case 'light':
      return ThemeMode.light;
    case 'dark':
      return ThemeMode.dark;
    default:
      return ThemeMode.system;
  }
}

String _encode(ThemeMode mode) {
  switch (mode) {
    case ThemeMode.light:
      return 'light';
    case ThemeMode.dark:
      return 'dark';
    case ThemeMode.system:
      return 'system';
  }
}

// ---------------------------------------------------------------------------
// Storage provider — override in tests to inject an in-memory fake.
// ---------------------------------------------------------------------------

/// Provides the [FlutterSecureStorage] instance used by [ThemeNotifier].
/// Override in tests to inject an in-memory store:
///
/// ```dart
/// themeStorageProvider.overrideWithValue(_FakeStorage())
/// ```
final themeStorageProvider = Provider<FlutterSecureStorage>(
  (_) => const FlutterSecureStorage(),
);

// ---------------------------------------------------------------------------
// Notifier
// ---------------------------------------------------------------------------

class ThemeNotifier extends AsyncNotifier<ThemeMode> {
  @override
  Future<ThemeMode> build() async {
    final storage = ref.read(themeStorageProvider);
    try {
      final stored = await storage.read(key: _kThemeKey);
      return _decode(stored);
    } catch (_) {
      // Storage read failure → fall back to system default.
      return ThemeMode.system;
    }
  }

  Future<void> setTheme(ThemeMode mode) async {
    state = AsyncData(mode);
    try {
      await ref
          .read(themeStorageProvider)
          .write(key: _kThemeKey, value: _encode(mode));
    } catch (_) {
      // Non-fatal: the in-memory state is already updated for this session.
    }
  }
}

final themeNotifierProvider = AsyncNotifierProvider<ThemeNotifier, ThemeMode>(
  ThemeNotifier.new,
);
