import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

/// Turns whatever an auth call threw into a sentence a person can act on.
/// Never returns `toString()` of the raw exception.
String friendlyAuthMessage(Object error) {
  if (error is AuthException) {
    final code = error.code;
    final message = error.message.toLowerCase();
    switch (code) {
      case 'invalid_credentials':
        return "That email and password don't match an account. "
            'New here? Create an account instead.';
      case 'email_not_confirmed':
        return 'Confirm your email first — we sent you a link when you signed up.';
      case 'user_already_exists':
      case 'email_exists':
        return 'An account with this email already exists. Sign in instead.';
      case 'weak_password':
        return 'Choose a stronger password (at least 6 characters).';
      case 'over_request_rate_limit':
      case 'over_email_send_rate_limit':
        return 'Too many attempts. Wait a minute and try again.';
      case 'signup_disabled':
        return 'Sign-ups are currently closed.';
      case 'user_banned':
        return 'This account has been disabled. Contact support.';
      case 'validation_failed':
        return 'Enter a valid email address.';
    }
    if (error is AuthRetryableFetchException) return _offline;
    // Older servers omit `code`; fall back to the message text.
    if (message.contains('invalid login credentials')) {
      return "That email and password don't match an account. "
          'New here? Create an account instead.';
    }
    if (message.contains('already registered')) {
      return 'An account with this email already exists. Sign in instead.';
    }
    if (message.contains('email not confirmed')) {
      return 'Confirm your email first — we sent you a link when you signed up.';
    }
    return _generic;
  }
  if (error is SocketException ||
      error is http.ClientException ||
      error is TimeoutException) {
    return _offline;
  }
  return _generic;
}

/// True when the user backed out of the browser sheet themselves; callers
/// should stay quiet rather than show an error.
bool isAuthCancellation(Object error) {
  if (error is PlatformException) {
    final code = error.code.toLowerCase();
    return code.contains('cancel');
  }
  return false;
}

const _offline = "Can't reach the server. Check your connection and try again.";
const _generic = 'Something went wrong. Please try again.';

/// Client-side email check so an obvious typo never reaches the server.
bool looksLikeEmail(String value) =>
    RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value);
