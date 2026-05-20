import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/units.dart';
import '../../models/completed_workout.dart';
import '../../models/sport.dart';
import '../activities/activity_row.dart';
import '../activities/workout_detail_provider.dart';
import '../settings/units_notifier.dart';

// Curated extra stats worth surfacing beyond the named sections, mapped to
// display labels. Everything else in summaryStats (internal flags, ids,
// timestamps like manual/commute/utc_offset/start_date_local) is hidden so the
// detail screen stays clean instead of dumping the raw Strava payload.
const _overflowLabels = <String, String>{
  'moving_time': 'Moving Time',
  'elapsed_time': 'Elapsed Time',
  'calories': 'Calories',
  'kilojoules': 'Energy (kJ)',
  'average_temp': 'Avg Temp',
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
          context.go(_backRouteFor(from));
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
      error: (_, _) => Scaffold(
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
      context.go(_backRouteFor(from));
    }
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
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        leading: BackButton(
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go(_backRouteFor(from));
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
    final stats = workout.summaryStats;
    final rows = <Widget>[];
    for (final entry in _overflowLabels.entries) {
      final value = _formatOverflow(entry.key, stats[entry.key]);
      if (value == null) continue;
      rows.add(_StatRow(label: entry.value, value: value));
    }

    if (rows.isEmpty) return const SizedBox.shrink();

    return Column(
      children: [
        const SizedBox(height: 16),
        _SectionCard(title: 'More stats', children: rows),
      ],
    );
  }

  static String? _formatOverflow(String key, dynamic value) {
    if (value == null) return null;
    final num? n = value is num ? value : num.tryParse(value.toString());
    switch (key) {
      case 'moving_time':
      case 'elapsed_time':
        return n == null ? null : _formatHms(n.round());
      case 'average_temp':
        return n == null ? null : '${n.round()}°C';
      case 'calories':
      case 'kilojoules':
        return n?.round().toString();
      default:
        return value.toString();
    }
  }

  static String _formatHms(int seconds) {
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    final s = seconds % 60;
    final sPad = s.toString().padLeft(2, '0');
    if (h > 0) return '$h:${m.toString().padLeft(2, '0')}:$sPad';
    return '$m:$sPad';
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

String _backRouteFor(String from) {
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

class _PrimaryStatsCard extends ConsumerWidget {
  const _PrimaryStatsCard({required this.workout});
  final CompletedWorkoutRow workout;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sport = workout.sport;
    final prefs =
        ref.watch(unitsNotifierProvider).valueOrNull ?? const UnitsPrefs();
    final durationStr = workout.durationS != null
        ? _detailDuration(workout.durationS!)
        : '—';

    // Distance: hidden for strength; unit-formatted otherwise.
    String? distanceStr;
    if (sport != Sport.strength) {
      final m = workout.distanceM;
      distanceStr =
          (m != null && m > 0) ? formatDistance(m, prefs, sport) : '—';
    }

    // Pace / speed.
    String? paceStr;
    if (sport != Sport.strength && sport != Sport.mobility) {
      final m = workout.distanceM;
      final s = workout.durationS;
      if (m != null && m > 0 && s != null && s > 0) {
        final formatted = formatPaceOrSpeed(m, s, prefs, sport);
        if (formatted.isNotEmpty) paceStr = formatted;
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
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: theme.textTheme.bodyMedium
                  ?.copyWith(fontWeight: FontWeight.w500),
            ),
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
