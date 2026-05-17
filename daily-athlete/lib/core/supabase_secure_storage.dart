import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Implements supabase_flutter's LocalStorage interface using FlutterSecureStorage
/// so session tokens are stored in the keychain (iOS) / Android Keystore rather
/// than SharedPreferences, which is unencrypted on Android.
///
/// Pass an instance to Supabase.initialize(localStorage: ...).
///
/// Android backup note: flutter_secure_storage stores encrypted values in
/// SharedPreferences. To prevent session tokens from being included in Google
/// account backups, set android:fullBackupContent="@xml/backup_rules" in
/// AndroidManifest.xml and create res/xml/backup_rules.xml that excludes
/// the "FlutterSecureStorage" SharedPreferences file. See:
/// android/app/src/main/res/xml/backup_rules.xml
class SupabaseSecureLocalStorage extends LocalStorage {
  static const _key = 'supabase.session';

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  @override
  Future<void> initialize() async {}

  @override
  Future<bool> hasAccessToken() async =>
      await _storage.read(key: _key) != null;

  @override
  Future<String?> accessToken() => _storage.read(key: _key);

  @override
  Future<void> persistSession(String persistSessionString) =>
      _storage.write(key: _key, value: persistSessionString);

  @override
  Future<void> removePersistedSession() => _storage.delete(key: _key);
}
