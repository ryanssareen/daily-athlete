import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../features/auth/auth_notifier.dart';
import '../../models/user.dart';

/// Fetches the authenticated user's role_flags[0] after auth resolves.
/// Provides RoleFlag to all descendant widgets.
class RoleNotifier extends AsyncNotifier<RoleFlag> {
  @override
  Future<RoleFlag> build() async {
    // Depend on auth state — re-runs when auth changes.
    final authState = await ref.watch(authNotifierProvider.future);
    if (!authState.isAuthenticated) {
      // Not authenticated — role is irrelevant; return default.
      return RoleFlag.athlete;
    }

    final userId = authState.userId;
    if (userId == null) return RoleFlag.athlete;

    final supabase = Supabase.instance.client;
    final response = await supabase
        .from('users')
        .select('role_flags')
        .eq('id', userId)
        .single();

    // The query selects only role_flags, so parse that field directly.
    // Do NOT use UserRow.fromJson here — it requires id/email, which this
    // projection omits, and would cast null → String.
    final flags = (response['role_flags'] as List<dynamic>?)
            ?.map((f) => RoleFlag.fromString(f as String))
            .toList() ??
        const <RoleFlag>[];
    return flags.isNotEmpty ? flags.first : RoleFlag.athlete;
  }
}

final roleNotifierProvider = AsyncNotifierProvider<RoleNotifier, RoleFlag>(
  RoleNotifier.new,
);
