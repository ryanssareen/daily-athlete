import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'package:daily_athlete/features/auth/auth_errors.dart';

void main() {
  group('friendlyAuthMessage', () {
    test('wrong credentials never leaks the raw exception', () {
      final msg = friendlyAuthMessage(AuthApiException(
        'Invalid login credentials',
        statusCode: '400',
        code: 'invalid_credentials',
      ));
      expect(msg, contains('Create an account'));
      expect(msg, isNot(contains('AuthApiException')));
    });

    test('existing email on sign-up points to sign-in', () {
      final msg = friendlyAuthMessage(AuthApiException(
        'User already registered',
        statusCode: '422',
        code: 'user_already_exists',
      ));
      expect(msg, contains('Sign in'));
    });

    test('falls back to message text when the server sends no code', () {
      expect(
        friendlyAuthMessage(const AuthException('Invalid login credentials')),
        contains('Create an account'),
      );
    });

    test('network failures read as connectivity problems', () {
      expect(friendlyAuthMessage(const SocketException('x')), contains('connection'));
      expect(
        friendlyAuthMessage(AuthRetryableFetchException()),
        contains('connection'),
      );
    });

    test('unknown errors get a generic message', () {
      expect(friendlyAuthMessage(StateError('boom')), isNot(contains('boom')));
    });
  });

  test('isAuthCancellation recognises user-cancelled sheets', () {
    expect(isAuthCancellation(PlatformException(code: 'CANCELED')), isTrue);
    expect(isAuthCancellation(PlatformException(code: 'other')), isFalse);
  });

  test('looksLikeEmail', () {
    expect(looksLikeEmail('a@b.co'), isTrue);
    expect(looksLikeEmail('a@b'), isFalse);
    expect(looksLikeEmail('nope'), isFalse);
  });
}
