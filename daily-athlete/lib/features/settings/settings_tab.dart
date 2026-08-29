// SettingsTab — role-conditional settings screen.
//
// R17: Theme toggle (system / light / dark) → ThemeNotifier
// R18: Units preferences (distance, swim, weight) → UnitsNotifier
// R19: Strava connect/disconnect → StravaConnectSection
// R20: Athlete view: linked coach name or "No coach linked"
// R21: Coach view: linked athlete list with "Remove" action
//
// The tab is shared between roles; role-conditional sections are rendered
// based on RoleNotifier.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;

import '../../core/env.dart';
import '../../features/auth/auth_notifier.dart';
import '../../features/shell/role_notifier.dart';
import '../../models/user.dart';
import 'settings_providers.dart';
import 'strava_connect_section.dart';

class SettingsTab extends ConsumerWidget {
  const SettingsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authAsync = ref.watch(authNotifierProvider);
    final roleAsync = ref.watch(roleNotifierProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: authAsync.when(
        loading: () =>
            const Center(child: CircularProgressIndicator.adaptive()),
        error: (_, _) =>
            const Center(child: Text('Unable to load settings')),
        data: (auth) {
          if (!auth.isAuthenticated) {
            return const Center(child: Text('Please sign in'));
          }
          return ListView(
            children: [
              const SizedBox(height: 8),
              // --- R17: Theme ---
              _ThemeSection(),
              const Divider(height: 1),
              // --- R18: Units ---
              _UnitsSection(),
              const Divider(height: 1),
              // --- R19: Strava ---
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: StravaConnectSection(),
              ),
              const Divider(height: 1),
              // --- Role-conditional sections ---
              roleAsync.when(
                loading: () => const Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(
                      child: CircularProgressIndicator.adaptive()),
                ),
                error: (_, _) => const SizedBox.shrink(),
                data: (role) {
                  if (role == RoleFlag.coach) {
                    return _CoachRosterSection();
                  } else {
                    return Column(
                      children: [
                        _AthleteCoachSection(),
                        const Divider(height: 1),
                        _PlanHistorySection(),
                      ],
                    );
                  }
                },
              ),
              // --- Sign out ---
              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: OutlinedButton(
                  onPressed: () =>
                      ref.read(authNotifierProvider.notifier).signOut(),
                  child: const Text('Sign out'),
                ),
              ),
              const SizedBox(height: 32),
            ],
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// R17 — Theme toggle
// ---------------------------------------------------------------------------

class _ThemeSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeAsync = ref.watch(themeNotifierProvider);
    final current = themeAsync.valueOrNull ?? ThemeMode.system;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Appearance', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          SegmentedButton<ThemeMode>(
            segments: const [
              ButtonSegment(
                value: ThemeMode.system,
                icon: Icon(Icons.brightness_auto),
                label: Text('System'),
              ),
              ButtonSegment(
                value: ThemeMode.light,
                icon: Icon(Icons.light_mode),
                label: Text('Light'),
              ),
              ButtonSegment(
                value: ThemeMode.dark,
                icon: Icon(Icons.dark_mode),
                label: Text('Dark'),
              ),
            ],
            selected: {current},
            onSelectionChanged: (modes) {
              if (modes.isNotEmpty) {
                ref.read(themeNotifierProvider.notifier).setTheme(modes.first);
              }
            },
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// R18 — Units preferences
// ---------------------------------------------------------------------------

class _UnitsSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unitsAsync = ref.watch(unitsNotifierProvider);
    final prefs = unitsAsync.valueOrNull ?? const UnitsPrefs();
    final notifier = ref.read(unitsNotifierProvider.notifier);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Units', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          _UnitRow(
            label: 'Distance',
            options: const ['km', 'miles'],
            selected: prefs.distance,
            onChanged: notifier.setDistance,
          ),
          _UnitRow(
            label: 'Swim distance',
            options: const ['m', 'yards'],
            selected: prefs.swimDistance,
            onChanged: notifier.setSwimDistance,
          ),
          _UnitRow(
            label: 'Weight',
            options: const ['kg', 'lbs'],
            selected: prefs.weight,
            onChanged: notifier.setWeight,
          ),
        ],
      ),
    );
  }
}

class _UnitRow extends StatelessWidget {
  const _UnitRow({
    required this.label,
    required this.options,
    required this.selected,
    required this.onChanged,
  });

  final String label;
  final List<String> options;
  final String selected;
  final Future<void> Function(String) onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child:
                Text(label, style: Theme.of(context).textTheme.bodyMedium),
          ),
          SegmentedButton<String>(
            segments: options
                .map((o) => ButtonSegment(value: o, label: Text(o)))
                .toList(),
            selected: {selected},
            onSelectionChanged: (values) {
              if (values.isNotEmpty) onChanged(values.first);
            },
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// R20 — Athlete: linked coach info
// ---------------------------------------------------------------------------

class _AthleteCoachSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final linkAsync = ref.watch(athleteCoachLinkProvider);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Your Coach', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          linkAsync.when(
            loading: () => const LinearProgressIndicator(),
            error: (_, _) =>
                const Text('Could not load coach info. Pull to refresh.'),
            data: (info) {
              if (info == null) {
                return const Text(
                  'No coach linked',
                  style: TextStyle(color: Colors.grey),
                );
              }
              return Text(info.displayName);
            },
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Plan history — link to plan_history_screen.dart (mirrors web's
// "View plan history" link from /plan, but as a persistent, discoverable
// entry point rather than a buried in-page link).
// ---------------------------------------------------------------------------

class _PlanHistorySection extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.event_note_outlined),
      title: const Text('Training plans'),
      subtitle: const Text('View your active and past plans'),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => context.push('/plans'),
    );
  }
}

// ---------------------------------------------------------------------------
// R21 — Coach: athlete roster with remove action
// ---------------------------------------------------------------------------

class _CoachRosterSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final athletesAsync = ref.watch(coachAthletesProvider);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Your Athletes', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          athletesAsync.when(
            loading: () => const LinearProgressIndicator(),
            error: (_, _) =>
                const Text('Could not load athletes. Pull to refresh.'),
            data: (athletes) {
              if (athletes.isEmpty) {
                return const Text(
                  'No linked athletes',
                  style: TextStyle(color: Colors.grey),
                );
              }
              return Column(
                children: athletes
                    .map((a) => _AthleteRow(athlete: a))
                    .toList(),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _AthleteRow extends ConsumerWidget {
  const _AthleteRow({required this.athlete});
  final AthleteInfo athlete;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(athlete.displayName),
      trailing: TextButton(
        onPressed: () => _confirmRemove(context, ref),
        child: const Text('Remove', style: TextStyle(color: Colors.red)),
      ),
    );
  }

  Future<void> _confirmRemove(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Remove athlete?'),
        content: Text(
          'Remove ${athlete.displayName} from your roster? '
          'They will see "No coach linked" in their settings.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remove', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    final token = ref.read(authNotifierProvider).valueOrNull?.accessToken;
    await _archiveLink(athlete.linkId, token);
    ref.invalidate(coachAthletesProvider);
  }

  Future<void> _archiveLink(String linkId, String? token) async {
    try {
      final uri = Uri.parse('${Env.apiBaseUrl}/api/coach/links/$linkId/archive');
      final client = http.Client();
      try {
        await client.patch(
          uri,
          headers: {
            'Content-Type': 'application/json',
            if (token != null) 'Authorization': 'Bearer $token',
          },
        );
      } finally {
        client.close();
      }
    } catch (_) {
      // Non-fatal: cache is invalidated above; user can retry.
    }
  }
}
