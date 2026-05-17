import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../features/activities/activities_providers.dart';

// ---------------------------------------------------------------------------
// athleteListProvider
//
// Fetches all athletes linked to the authenticated coach via
// coach_athlete_links. Used by AthleteSelectorDropdown.
// ---------------------------------------------------------------------------

final _athleteListProvider =
    FutureProvider<List<_AthleteItem>>((ref) async {
  final supabase = Supabase.instance.client;
  final userId = supabase.auth.currentUser?.id;
  if (userId == null) return [];

  final data = await supabase
      .from('coach_athlete_links')
      .select('athlete_id, users!athlete_id(id, display_name, email)')
      .eq('coach_id', userId)
      .isFilter('deleted_at', null);

  return (data as List<dynamic>).map((row) {
    final user = row['users'] as Map<String, dynamic>? ?? {};
    final athleteId = user['id'] as String? ?? row['athlete_id'] as String;
    final name = user['display_name'] as String? ??
        user['email'] as String? ??
        athleteId;
    return _AthleteItem(id: athleteId, displayName: name);
  }).toList();
});

class _AthleteItem {
  const _AthleteItem({required this.id, required this.displayName});
  final String id;
  final String displayName;
}

/// Dropdown widget for coaches to select which athlete's data to view.
/// Exposes a "My athletes" placeholder as the first option (clears selection).
///
/// Updating the selection writes to [selectedAthleteIdProvider], which
/// triggers [activityFeedProvider] to refetch for the new athlete.
class AthleteSelectorDropdown extends ConsumerWidget {
  const AthleteSelectorDropdown({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final athletes = ref.watch(_athleteListProvider);
    final selectedId = ref.watch(selectedAthleteIdProvider);

    return athletes.when(
      loading: () => const SizedBox(
        height: 36,
        width: 36,
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      ),
      error: (_, __) => const SizedBox.shrink(),
      data: (list) {
        if (list.isEmpty) return const SizedBox.shrink();

        final items = <DropdownMenuItem<String?>>[
          const DropdownMenuItem(value: null, child: Text('All athletes')),
          ...list.map(
            (a) => DropdownMenuItem(value: a.id, child: Text(a.displayName)),
          ),
        ];

        return DropdownButton<String?>(
          value: selectedId,
          items: items,
          onChanged: (id) =>
              ref.read(selectedAthleteIdProvider.notifier).state = id,
          underline: const SizedBox.shrink(),
          icon: const Icon(Icons.arrow_drop_down),
        );
      },
    );
  }
}
