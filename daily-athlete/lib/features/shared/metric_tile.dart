import 'package:flutter/material.dart';

import '../../core/da_theme.dart';

/// Label, large mono value and an optional sub line, on a bordered card.
class MetricTile extends StatelessWidget {
  const MetricTile({super.key, required this.label, required this.value, this.sub});

  final String label;
  final String value;
  final String? sub;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: textTheme.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 6),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(value, maxLines: 1, style: context.da.metricLarge),
            ),
            if (sub != null) ...[
              const SizedBox(height: 4),
              Text(
                sub!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
