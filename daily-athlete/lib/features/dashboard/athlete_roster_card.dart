import 'package:flutter/material.dart';

import 'dashboard_providers.dart';

/// Card shown in the coach roster list.
///
/// Displays athlete name, weekly compliance ratio, a progress bar, and the
/// date of the last recorded activity.  Tapping calls [onTap].
class AthleteRosterCard extends StatelessWidget {
  const AthleteRosterCard({
    super.key,
    required this.entry,
    required this.onTap,
  });

  final AthleteRosterEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final stats = entry.weeklyStats;
    final pct = stats.plannedCount == 0
        ? 0.0
        : (stats.completedCount / stats.plannedCount).clamp(0.0, 1.0);
    final pctLabel = stats.plannedCount == 0
        ? 'No plan'
        : '${stats.completedCount} / ${stats.plannedCount} this week';

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _AvatarCircle(name: entry.name),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          entry.name,
                          style: theme.textTheme.titleSmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (entry.lastActivityDate != null) ...[
                          const SizedBox(height: 2),
                          Text(
                            'Last active ${_relativeDate(entry.lastActivityDate!)}',
                            style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_right_outlined),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Compliance',
                    style: theme.textTheme.labelMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant),
                  ),
                  Text(pctLabel,
                      style: theme.textTheme.labelMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant)),
                ],
              ),
              const SizedBox(height: 6),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: pct,
                  minHeight: 6,
                  backgroundColor: theme.colorScheme.surfaceContainerHighest,
                  valueColor: AlwaysStoppedAnimation<Color>(
                    _complianceColor(pct, theme),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _complianceColor(double pct, ThemeData theme) {
    if (pct >= 0.8) return theme.colorScheme.primary;
    if (pct >= 0.5) return theme.colorScheme.tertiary;
    return theme.colorScheme.error;
  }

  String _relativeDate(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date).inDays;
    if (diff == 0) return 'today';
    if (diff == 1) return 'yesterday';
    if (diff < 7) return '$diff days ago';
    if (diff < 14) return '1 week ago';
    return '${(diff / 7).floor()} weeks ago';
  }
}

class _AvatarCircle extends StatelessWidget {
  const _AvatarCircle({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final initial =
        name.isNotEmpty ? name[0].toUpperCase() : '?';
    return CircleAvatar(
      radius: 22,
      backgroundColor: theme.colorScheme.secondaryContainer,
      child: Text(
        initial,
        style: theme.textTheme.titleMedium?.copyWith(
            color: theme.colorScheme.onSecondaryContainer),
      ),
    );
  }
}
