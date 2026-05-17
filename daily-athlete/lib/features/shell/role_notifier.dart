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

    final row = UserRow.fromJson(response);
    return row.primaryRole;
  }
}

final roleNotifierProvider = AsyncNotifierProvider<RoleNotifier, RoleFlag>(
  RoleNotifier.new,
);
