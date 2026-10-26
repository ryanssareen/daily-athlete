import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../router/routes.dart';
import '../auth/auth_notifier.dart';
import 'onboarding_api.dart';

/// First-run setup for new athletes: name, sport, weekly hours, target event,
/// then a pointer to Strava. Mirrors the web flow at
/// apps/web/app/(athlete-onboarding)/athlete/onboarding.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

const _sports = [
  ('tri', 'Triathlon', 'Multi-sport · brick days', Icons.all_inclusive),
  ('run', 'Run', '5K → marathon', Icons.directions_run),
  ('bike', 'Bike', 'Road / gravel / track', Icons.directions_bike),
  ('swim', 'Swim', 'Pool & open water', Icons.pool),
];
const _patterns = [
  'Even split',
  'Mostly weekends',
  'Mornings only',
  'Evenings',
];
const _eventTypes = [
  '5K',
  '10K',
  'Half marathon',
  'Marathon',
  'Sprint Tri',
  'Olympic Tri',
  '70.3',
  'Ironman',
];
const _lastStep = 4;

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _nameController = TextEditingController();
  int _step = 0;
  String _sport = 'tri';
  double _hours = 8;
  String _pattern = _patterns.first;
  String? _eventType;
  DateTime? _eventDate;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _eventDate ?? now.add(const Duration(days: 90)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365 * 3)),
    );
    if (picked != null) setState(() => _eventDate = picked);
  }

  Future<void> _finish({bool openSettings = false}) async {
    final userId = ref.read(authNotifierProvider).valueOrNull?.userId;
    if (userId == null) return;
    final router = GoRouter.of(context);
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await saveOnboarding(
        userId,
        OnboardingAnswers(
          nickname: _nameController.text,
          primarySport: _sport,
          weeklyHours: _hours.round(),
          trainingPattern: _pattern,
          eventType: _eventType,
          eventDate: _eventDate,
        ),
      );
      ref.invalidate(onboardingCompleteProvider);
      router.go(Routes.dashboard);
      if (openSettings) router.push(Routes.settings);
    } catch (_) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error =
              "Couldn't save your answers. Check your connection and try again.";
        });
      }
    }
  }

  void _next() {
    if (_step == _lastStep) {
      _finish();
    } else {
      setState(() => _step++);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isLast = _step == _lastStep;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: LinearProgressIndicator(
                      value: (_step + 1) / (_lastStep + 1),
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  TextButton(
                    onPressed: _saving ? null : _finish,
                    child: const Text('Skip'),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Expanded(
                child: SingleChildScrollView(
                  child: AnimatedSwitcher(
                    duration: const Duration(milliseconds: 200),
                    child: KeyedSubtree(
                      key: ValueKey(_step),
                      child: _buildStep(theme),
                    ),
                  ),
                ),
              ),
              if (_error != null) ...[
                Text(
                  _error!,
                  style: TextStyle(
                    color: theme.colorScheme.error,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 8),
              ],
              Row(
                children: [
                  if (_step > 0)
                    TextButton(
                      onPressed: _saving ? null : () => setState(() => _step--),
                      child: const Text('Back'),
                    ),
                  const Spacer(),
                  FilledButton(
                    onPressed: _saving ? null : _next,
                    child: _saving
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(isLast ? 'Finish' : 'Continue'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _heading(ThemeData theme, String title, String subtitle) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        title,
        style: theme.textTheme.headlineSmall?.copyWith(
          fontWeight: FontWeight.bold,
        ),
      ),
      const SizedBox(height: 8),
      Text(
        subtitle,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
      const SizedBox(height: 24),
    ],
  );

  Widget _buildStep(ThemeData theme) {
    switch (_step) {
      case 0:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _heading(
              theme,
              'Welcome to Daily Athlete',
              "Let's set up your training profile. What should we call you?",
            ),
            TextField(
              controller: _nameController,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.done,
              maxLength: 80,
              decoration: const InputDecoration(
                labelText: 'Name or nickname',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        );
      case 1:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _heading(
              theme,
              'What do you train for?',
              'Pick your main sport. You can log the others too.',
            ),
            for (final (id, name, meta, icon) in _sports)
              Card(
                color: _sport == id ? theme.colorScheme.primaryContainer : null,
                child: ListTile(
                  leading: Icon(icon),
                  title: Text(name),
                  subtitle: Text(meta),
                  trailing: _sport == id ? const Icon(Icons.check) : null,
                  onTap: () => setState(() => _sport = id),
                ),
              ),
          ],
        );
      case 2:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _heading(
              theme,
              'How much time do you have?',
              'Roughly how many hours a week can you train?',
            ),
            Center(
              child: Text(
                '${_hours.round()} h / week',
                style: theme.textTheme.titleLarge,
              ),
            ),
            Slider(
              value: _hours,
              min: 1,
              max: 40,
              divisions: 39,
              label: '${_hours.round()}',
              onChanged: (v) => setState(() => _hours = v),
            ),
            const SizedBox(height: 16),
            Text(
              'When do you usually train?',
              style: theme.textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                for (final p in _patterns)
                  ChoiceChip(
                    label: Text(p),
                    selected: _pattern == p,
                    onSelected: (_) => setState(() => _pattern = p),
                  ),
              ],
            ),
          ],
        );
      case 3:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _heading(
              theme,
              'Got a goal race?',
              'Optional. Pick an event and date so your plan can build toward it.',
            ),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                for (final t in _eventTypes)
                  ChoiceChip(
                    label: Text(t),
                    selected: _eventType == t,
                    onSelected: (on) =>
                        setState(() => _eventType = on ? t : null),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _pickDate,
              icon: const Icon(Icons.event),
              label: Text(
                _eventDate == null
                    ? 'Pick a date'
                    : MaterialLocalizations.of(
                        context,
                      ).formatMediumDate(_eventDate!),
              ),
            ),
            if (_eventType != null && _eventDate == null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Add a date to save this event.',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
          ],
        );
      default:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _heading(
              theme,
              'Bring in your training',
              'Connect Strava to pull in your recent activities and keep your calendar in sync. You can also do this later in Settings.',
            ),
            OutlinedButton.icon(
              onPressed: _saving ? null : () => _finish(openSettings: true),
              icon: const Icon(Icons.link),
              label: const Text('Finish and connect Strava'),
            ),
          ],
        );
    }
  }
}
