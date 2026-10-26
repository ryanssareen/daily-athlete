import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Auth state — mirrors supabase.auth.onAuthStateChange stream.
/// Loading: initial session check in progress (prevents wrong-content flash).
/// Authenticated: valid session present.
/// Unauthenticated: no session or session expired.
enum AuthStatus { loading, authenticated, unauthenticated }

class AuthState {
  const AuthState({required this.status, this.session});
  final AuthStatus status;
  final Session? session;

  bool get isAuthenticated => status == AuthStatus.authenticated;
  bool get isLoading => status == AuthStatus.loading;
  String? get accessToken => session?.accessToken;
  String? get userId => session?.user.id;
}

/// What happened after a sign-up call that did not throw.
enum SignUpOutcome {
  /// Session issued immediately; the router takes over.
  signedIn,

  /// Account created but the project requires email confirmation first.
  confirmEmail,

  /// Email already belongs to an account (Supabase hides this by returning a
  /// user with no identities instead of an error).
  alreadyRegistered,
}

class AuthNotifier extends AsyncNotifier<AuthState> {
  @override
  Future<AuthState> build() async {
    // Resolve initial session from flutter_secure_storage before exposing state.
    // This is what prevents the wrong-content flash on app launch.
    final supabase = Supabase.instance.client;
    final session = supabase.auth.currentSession;

    // Subscribe to subsequent auth changes and rebuild on each event.
    ref.onDispose(
      supabase.auth.onAuthStateChange.listen((data) {
        final newSession = data.session;
        state = AsyncData(
          AuthState(
            status: newSession != null
                ? AuthStatus.authenticated
                : AuthStatus.unauthenticated,
            session: newSession,
          ),
        );
      }).cancel,
    );

    return AuthState(
      status: session != null
          ? AuthStatus.authenticated
          : AuthStatus.unauthenticated,
      session: session,
    );
  }

  Future<void> signInWithPassword(String email, String password) async {
    final supabase = Supabase.instance.client;
    await supabase.auth.signInWithPassword(email: email, password: password);
  }

  Future<SignUpOutcome> signUpWithPassword(
    String email,
    String password,
  ) async {
    final supabase = Supabase.instance.client;
    final response = await supabase.auth.signUp(
      email: email,
      password: password,
    );
    if (response.session != null) return SignUpOutcome.signedIn;
    final identities = response.user?.identities;
    if (identities != null && identities.isEmpty) {
      return SignUpOutcome.alreadyRegistered;
    }
    return SignUpOutcome.confirmEmail;
  }

  Future<void> signInWithGoogle() async {
    final supabase = Supabase.instance.client;
    await supabase.auth.signInWithOAuth(
      OAuthProvider.google,
      redirectTo: 'da2://auth/callback',
    );
  }

  Future<void> signInWithApple() async {
    final supabase = Supabase.instance.client;
    await supabase.auth.signInWithOAuth(
      OAuthProvider.apple,
      redirectTo: 'da2://auth/callback',
    );
  }

  Future<void> signOut() async {
    await Supabase.instance.client.auth.signOut();
  }
}

final authNotifierProvider = AsyncNotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);
