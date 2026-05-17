import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../../models/completed_workout.dart';
import '../../models/sport.dart';
import '../activities/activity_row.dart';

/// Full activity detail screen (R7).
/// Shows all summary_stats fields in a readable card layout.
/// If summary_stats contains a non-null 'map_polyline' (encoded polyline),
/// renders a flutter_map tile map with the GPS track decoded.
class ActivityDetailScreen extends StatelessWidget {
  const ActivityDetailScreen({super.key, required this.workout});

  final CompletedWorkoutRow workout;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final stats = workout.summaryStats;
    final polyline = stats['map_polyline'] as String?;

    return Scaffold(
      appBar: AppBar(
        title: Text(workout.name ?? workout.sport.displayName),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Sport + date header
          Row(
            children: [
              Icon(
                sportIcon(workout.sport),
                color: theme.colorScheme.primary,
              ),
              const SizedBox(width: 8),
              Text(
                workout.sport.displayName,
                style: theme.textTheme.titleMedium,
              ),
              const Spacer(),
              Text(
                _formattedDateTime(workout.startedAt),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Key stats row
          _KeyStatsRow(workout: workout),
          const SizedBox(height: 20),

          // Map if polyline available (R7)
          if (polyline != null && polyline.isNotEmpty) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                height: 240,
                child: _ActivityMap(encodedPolyline: polyline),
              ),
            ),
            const SizedBox(height: 20),
          ],

          // Full stats card
          if (stats.isNotEmpty) _StatsCard(stats: stats),
        ],
      ),
    );
  }

  static String _formattedDateTime(DateTime dt) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final min = dt.minute.toString().padLeft(2, '0');
    final ampm = dt.hour < 12 ? 'AM' : 'PM';
    return '${months[dt.month - 1]} ${dt.day}, ${dt.year} $hour:$min $ampm';
  }
}

// ---------------------------------------------------------------------------
// Key stats row
// ---------------------------------------------------------------------------

class _KeyStatsRow extends StatelessWidget {
  const _KeyStatsRow({required this.workout});
  final CompletedWorkoutRow workout;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final items = <({String label, String value})>[];

    if (workout.distanceM != null && workout.distanceM! > 0) {
      final km = workout.distanceM! / 1000;
      items.add((label: 'Distance', value: '${km.toStringAsFixed(2)} km'));
    }
    if (workout.durationS != null) {
      items.add(
        (label: 'Duration', value: _detailDuration(workout.durationS!)),
      );
    }

    // Pace for run (min/km)
    if (workout.sport == Sport.run &&
        workout.distanceM != null &&
        workout.distanceM! > 0 &&
        workout.durationS != null) {
      final paceSecPerKm = workout.durationS! / (workout.distanceM! / 1000);
      final paceMin = paceSecPerKm ~/ 60;
      final paceSec = (paceSecPerKm % 60).round().toString().padLeft(2, '0');
      items.add((label: 'Pace', value: '$paceMin:$paceSec /km'));
    }

    if (items.isEmpty) return const SizedBox.shrink();

    return Row(
      children: items
          .map(
            (item) => Expanded(
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
                  child: Column(
                    children: [
                      Text(
                        item.value,
                        style: theme.textTheme.titleLarge
                            ?.copyWith(fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        item.label,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          )
          .toList(),
    );
  }

  static String _detailDuration(int seconds) {
    final h = seconds ~/ 3600;
    final m = (seconds % 3600) ~/ 60;
    final s = seconds % 60;
    if (h > 0) return '${h}h ${m}m';
    return '${m}m ${s}s';
  }
}

// ---------------------------------------------------------------------------
// Stats card — renders all summary_stats fields
// ---------------------------------------------------------------------------

class _StatsCard extends StatelessWidget {
  const _StatsCard({required this.stats});
  final Map<String, dynamic> stats;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // Exclude map_polyline from the display (rendered above as a map).
    final displayEntries = stats.entries
        .where((e) => e.key != 'map_polyline' && e.value != null)
        .toList();

    if (displayEntries.isEmpty) return const SizedBox.shrink();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Details', style: theme.textTheme.titleSmall),
            const SizedBox(height: 12),
            ...displayEntries.map(
              (e) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      _labelFor(e.key),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    Text(
                      _valueFor(e.value),
                      style: theme.textTheme.bodyMedium
                          ?.copyWith(fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
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
}

// ---------------------------------------------------------------------------
// Map widget (R7)
// ---------------------------------------------------------------------------

class _ActivityMap extends StatelessWidget {
  const _ActivityMap({required this.encodedPolyline});
  final String encodedPolyline;

  @override
  Widget build(BuildContext context) {
    final points = _decodePolyline(encodedPolyline);
    if (points.isEmpty) {
      return const Center(child: Text('No GPS data'));
    }

    return FlutterMap(
      options: MapOptions(
        initialCameraFit: CameraFit.coordinates(
          coordinates: points,
          padding: const EdgeInsets.all(16),
        ),
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.none,
        ),
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'com.da2.daily_athlete',
        ),
        PolylineLayer(
          polylines: [
            Polyline(
              points: points,
              strokeWidth: 3,
              color: Theme.of(context).colorScheme.primary,
            ),
          ],
        ),
      ],
    );
  }

  /// Decodes a Google-encoded polyline string into a list of LatLng points.
  /// Algorithm: https://developers.google.com/maps/documentation/utilities/polylinealgorithm
  static List<LatLng> _decodePolyline(String encoded) {
    final result = <LatLng>[];
    int index = 0;
    int lat = 0;
    int lng = 0;

    while (index < encoded.length) {
      int shift = 0;
      int resultLat = 0;
      int b;
      do {
        if (index >= encoded.length) break;
        b = encoded.codeUnitAt(index++) - 63;
        resultLat |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      final dlat = (resultLat & 1) != 0 ? ~(resultLat >> 1) : (resultLat >> 1);
      lat += dlat;

      shift = 0;
      int resultLng = 0;
      do {
        if (index >= encoded.length) break;
        b = encoded.codeUnitAt(index++) - 63;
        resultLng |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      final dlng = (resultLng & 1) != 0 ? ~(resultLng >> 1) : (resultLng >> 1);
      lng += dlng;

      result.add(LatLng(lat / 1e5, lng / 1e5));
    }
    return result;
  }
}
