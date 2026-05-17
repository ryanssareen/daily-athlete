import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/completed_workout.dart';
import '../../models/sport.dart';
import '../activities/activity_row.dart';
import '../activities/workout_detail_provider.dart';

// Keys that appear in named sections — excluded from the overflow card.
const _namedKeys = {
  'name',
  'average_speed',
  'max_speed',
  'average_heartrate',
  'max_heartrate',
  'average_watts',
  'max_watts',
  'total_elevation_gain',
  'suffer_score',
  'average_cadence',
  'map_polyline',
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

class ActivityDetailScreen extends ConsumerWidget {
  const ActivityDetailScreen({
    super.key,
    required this.workoutId,
    required this.from,
  });

  final String workoutId;
  final String from;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workoutAsync = ref.watch(workoutDetailProvider(workoutId));

    ref.listen(workoutDetailProvider(workoutId), (_, next) {
      final hasError = next is AsyncError;
      final notFound = next is AsyncData && next.value == null;
      if (hasError || notFound) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not load workout')),
        );
        if (context.canPop()) {
          context.pop();
        } else {
          context.go(_fallbackRoute(from));
        }
      }
    });

    return workoutAsync.when(
      loading: () => Scaffold(
        appBar: AppBar(
          leading: BackButton(onPressed: () => _navigateBack(context)),
        ),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (_, __) => Scaffold(
        appBar: AppBar(
          leading: BackButton(onPressed: () => _navigateBack(context)),
        ),
        body: const Center(child: CircularProgressIndicator()),
      ),
      data: (workout) {
        if (workout == null) {
          return Scaffold(
            appBar: AppBar(
              leading: BackButton(onPressed: () => _navigateBack(context)),
            ),
            body: const Center(child: CircularProgressIndicator()),
          );
        }
        return _DetailScaffold(workout: workout, from: from);
      },
    );
  }

  void _navigateBack(BuildContext context) {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(_fallbackRoute(from));
    }
  }

  static String _fallbackRoute(String from) {
    if (from == 'dashboard') return '/dashboard';
    if (from == 'calendar') return '/calendar';
    return '/activities';
  }
}

// ---------------------------------------------------------------------------
// Detail scaffold — only shown once data is loaded
// ---------------------------------------------------------------------------

class _DetailScaffold extends StatelessWidget {
  const _DetailScaffold({required this.workout, required this.from});

  final CompletedWorkoutRow workout;
  final String from;

  @override
  Widget build(BuildContext context) {
    final title = (workout.name?.isNotEmpty == true)
        ? workout.name!
        : workout.sport.displayName;
    final backLabel = _backLabel(from);

    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        leading: BackButton(
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go(_ActivityDetailScreen_fallbackRoute(from));
            }
          },
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildHeader(context),
          const SizedBox(height: 20),
          _PrimaryStatsCard(workout: workout),
          ..._buildSportSections(context),
          _buildOverflow(context),
          if (!workout.isStrava) _StravaConnectNote(),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  static String _backLabel(String from) {
    if (from == 'dashboard') return 'Dashboard';
    if (from == 'calendar') return 'Calendar';
    return 'Activities';
  }

  Widget _buildHeader(BuildContext context) {
    final theme = Theme.of(context);
    final dateTime = _formatDateTime(workout.startedAt.toLocal());
    final sourceBadgeText =
        workout.isStrava ? 'Strava' : 'Manual Entry';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(sportIcon(workout.sport), color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                workout.sport.displayName,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          dateTime,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 8),
        Chip(
          label: Text(
            sourceBadgeText,
            style: const TextStyle(fontSize: 11),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 4),
          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
          visualDensity: VisualDensity.compact,
        ),
      ],
    );
  }

  List<Widget> _buildSportSections(BuildContext context) {
    final stats = workout.summaryStats;
    final isStrava = workout.isStrava;
    final sport = workout.sport;
    final widgets = <Widget>[];

    if (!isStrava) return widgets;

    // Heart rate
    final avgHR = stats['average_heartrate'] as num?;
    final maxHR = stats['max_heartrate'] as num?;
    if (avgHR != null) {
      widgets.add(const SizedBox(height: 16));
      widgets.add(
        _SectionCard(
          title: 'Heart Rate',
          children: [
            _StatRow(label: 'Avg HR', value: '${avgHR.round()} bpm'),
            if (maxHR != null)
              _StatRow(label: 'Max HR', value: '${maxHR.round()} bpm'),
          ],
        ),
      );
    }

    // Power (bike only)
    if (sport == Sport.bike) {
      final avgWatts = stats['average_watts'] as num?;
      if (avgWatts != null) {
        widgets.add(const SizedBox(height: 16));
        widgets.add(
          _SectionCard(
            title: 'Power',
            children: [
              _StatRow(label: 'Avg Power', value: '${avgWatts.round()} W'),
            ],
          ),
        );
      }
    }

    // Elevation (non-strength)
    if (sport != Sport.strength) {
      final elevation = stats['total_elevation_gain'] as num?;
      if (elevation != null) {
        widgets.add(const SizedBox(height: 16));
        widgets.add(
          _SectionCard(
            title: 'Elevation',
            children: [
              _StatRow(label: 'Gain', value: '${elevation.round()} m'),
            ],
          ),
        );
      }
    }

    // Stroke rate (swim only)
    if (sport == Sport.swim) {
      final cadence = stats['average_cadence'] as num?;
      if (cadence != null) {
        widgets.add(const SizedBox(height: 16));
        widgets.add(
          _SectionCard(
            title: 'Stroke Rate',
            children: [
              _StatRow(
                label: 'Avg Stroke Rate',
                value: '${cadence.round()} spm',
              ),
            ],
          ),
        );
      }
    }

    // Relative effort
    final sufferScore = stats['suffer_score'] as num?;
    if (sufferScore != null) {
      widgets.add(const SizedBox(height: 16));
      widgets.add(
        _SectionCard(
          title: 'Effort',
          children: [
            _StatRow(
              label: 'Relative Effort',
              value: sufferScore.round().toString(),
            ),
          ],
        ),
      );
    }

    return widgets;
  }

  Widget _buildOverflow(BuildContext context) {
    final overflowEntries = workout.summaryStats.entries
        .where((e) => !_namedKeys.contains(e.key) && e.value != null)
        .toList();

    if (overflowEntries.isEmpty) return const SizedBox.shrink();

    return Column(
      children: [
        const SizedBox(height: 16),
        _SectionCard(
          title: 'More stats',
          children: overflowEntries
              .map(
                (e) => _StatRow(
                  label: _labelFor(e.key),
                  value: _valueFor(e.value),
                ),
              )
              .toList(),
        ),
      ],
    );
  }

  static String _labelFor(String key) {
    return key
        .replaceAll('_', ' ')
        .split(' ')
        .map((w) => w.isEmpty ? '' : '${w[0].toUpperCase()}${w.substring(1)}')
        .join(' ');
  }

  static String _valueFor(dynamic value) {
    if (value == null) return '—';
    if (value is double) return value.toStringAsFixed(1);
    return value.toString();
  }

  static String _formatDateTime(DateTime localDt) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    final hour = localDt.hour % 12 == 0 ? 12 : localDt.hour % 12;
    final min = localDt.minute.toString().padLeft(2, '0');
    final ampm = localDt.hour < 12 ? 'AM' : 'PM';
    return '${months[localDt.month - 1]} ${localDt.day} · $hour:$min $ampm';
  }
}

// Top-level helper so the back button lambda can call it without a `this`.
String _ActivityDetailScreen_fallbackRoute(String from) {
  if (from == 'dashboard') return '/dashboard';
  if (from == 'calendar') return '/calendar';
  return '/activities';
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

extension on CompletedWorkoutRow {
  bool get isStrava => source == CompletedWorkoutSource.strava;
}

// ---------------------------------------------------------------------------
// Primary stats card
// ---------------------------------------------------------------------------

class _PrimaryStatsCard extends StatelessWidget {
  const _PrimaryStatsCard({required this.workout});
  final CompletedWorkoutRow workout;

  @override
  Widget build(BuildContext context) {
    final sport = workout.sport;
    final durationStr = workout.durationS != null
        ? _detailDuration(workout.durationS!)
        : '—';

    // Distance: hidden for strength; meters for swim; km otherwise
    String? distanceStr;
    if (sport != Sport.strength) {
      final m = workout.distanceM;
      if (m != null && m > 0) {
        distanceStr =
            sport == Sport.swim ? '${m.round()} m' : '${(m / 1000).toStringAsFixed(1)} km';
      } else {
        distanceStr = '—';
      }
    }

    // Pace / speed
    String? paceStr;
    if (sport != Sport.strength && sport != Sport.mobility) {
      final m = workout.distanceM;
      final s = workout.durationS;
      if (m != null && m > 0 && s != null && s > 0) {
        if (sport == Sport.bike) {
          final kmh = (m / 1000) / (s / 3600);
          paceStr = '${kmh.toStringAsFixed(1)} km/h';
        } else {
          final unit = sport == Sport.swim ? 100.0 : 1000.0;
          final ps = (s / m) * unit;
          final pm = ps ~/ 60;
          final ps2 = (ps % 60).round().toString().padLeft(2, '0');
          final label = sport == Sport.swim ? '/100m' : '/km';
          paceStr = '$pm:$ps2 $label';
        }
      }
    }

    final items = <({String label, String value})>[
      (label: 'Duration', value: durationStr),
      if (distanceStr != null) (label: 'Distance', value: distanceStr),
      if (paceStr != null)
        (label: sport == Sport.bike ? 'Speed' : 'Pace', value: paceStr),
    ];

    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
        child: Row(
          children: items
              .map(
                (item) => Expanded(
                  child: Column(
                    children: [
                      Text(
                        item.value,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        item.label,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurfaceVariant,
                            ),
                      ),
                    ],
                  ),
                ),
              )
              .toList(),
        ),
      ),
    );
  }

  static String _detailDuration(int seconds) {
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    final s = seconds % 60;
    final sPad = s.toString().padLeft(2, '0');
    if (h > 0) {
      return '$h:${m.toString().padLeft(2, '0')}:$sPad';
    }
    return '$m:$sPad';
  }
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

class _SectionCard extends StatelessWidget {
  const _SectionCard({required this.title, required this.children});
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 12),
            ...children,
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Stat row (label + value)
// ---------------------------------------------------------------------------

class _StatRow extends StatelessWidget {
  const _StatRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          Text(
            value,
            style: theme.textTheme.bodyMedium
                ?.copyWith(fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Strava connect nudge (manual workouts only)
// ---------------------------------------------------------------------------

class _StravaConnectNote extends StatelessWidget {
  const _StravaConnectNote();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: 24),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          'Logged manually — connect Strava in Settings for detailed stats.',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}
