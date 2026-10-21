import 'package:flutter/material.dart';

/// One heart-rate zone bucket from Strava's `/activities/:id/zones`.
class HrZoneBucket {
  const HrZoneBucket({required this.min, required this.max, required this.seconds});

  final int min;
  final int max; // -1 means open-ended (Strava's top zone)
  final int seconds;
}

/// Pulls the heart-rate distribution out of `summary_stats['zones']`, which
/// holds one entry per zone type (heartrate, power). Returns an empty list
/// when the workout hasn't been hydrated or has no HR zones.
List<HrZoneBucket> parseHrZones(Map<String, dynamic> stats) {
  final zones = stats['zones'];
  if (zones is! List) return const [];
  for (final entry in zones) {
    if (entry is! Map || entry['type'] != 'heartrate') continue;
    final buckets = entry['distribution_buckets'];
    if (buckets is! List) return const [];
    return [
      for (final b in buckets)
        if (b is Map)
          HrZoneBucket(
            min: (b['min'] as num?)?.round() ?? 0,
            max: (b['max'] as num?)?.round() ?? -1,
            seconds: (b['time'] as num?)?.round() ?? 0,
          ),
    ];
  }
  return const [];
}

// Same palette as the web zone distribution (apps/web/src/lib/zone-palette.ts).
const _zoneColors = <Color>[
  Color(0xFFA09890),
  Color(0xFF7DA78C),
  Color(0xFFD4A64A),
  Color(0xFFD97E3A),
  Color(0xFFC45A30),
];

String formatZoneTime(int seconds) {
  final s = seconds < 0 ? 0 : seconds;
  final h = s ~/ 3600;
  final m = (s % 3600) ~/ 60;
  if (h > 0) return '${h}h ${m}m';
  if (m > 0) return '${m}m';
  return '${s}s';
}

/// Time-in-zone breakdown, one proportional bar per zone.
class HrZonesBreakdown extends StatelessWidget {
  const HrZonesBreakdown({super.key, required this.buckets});

  final List<HrZoneBucket> buckets;

  @override
  Widget build(BuildContext context) {
    final total = buckets.fold<int>(0, (sum, b) => sum + b.seconds);
    if (buckets.isEmpty || total <= 0) return const SizedBox.shrink();
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 12),
        Text(
          'Time in zone',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 8),
        for (var i = 0; i < buckets.length; i++)
          _ZoneRow(
            index: i,
            bucket: buckets[i],
            fraction: buckets[i].seconds / total,
            color: _zoneColors[i < _zoneColors.length ? i : _zoneColors.length - 1],
          ),
      ],
    );
  }
}

class _ZoneRow extends StatelessWidget {
  const _ZoneRow({
    required this.index,
    required this.bucket,
    required this.fraction,
    required this.color,
  });

  final int index;
  final HrZoneBucket bucket;
  final double fraction;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final range = bucket.max < 0 ? '${bucket.min}+' : '${bucket.min}–${bucket.max}';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          SizedBox(
            width: 28,
            child: Text('Z${index + 1}', style: theme.textTheme.bodySmall),
          ),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: Stack(
                children: [
                  Container(height: 14, color: theme.colorScheme.surfaceContainerHighest),
                  FractionallySizedBox(
                    widthFactor: fraction.clamp(0.0, 1.0),
                    child: Container(height: 14, color: color),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 92,
            child: Text(
              '${formatZoneTime(bucket.seconds)} · $range',
              textAlign: TextAlign.right,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
