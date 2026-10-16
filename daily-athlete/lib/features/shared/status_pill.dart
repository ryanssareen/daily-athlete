import 'package:flutter/material.dart';

/// Small status label. Filled uses secondaryContainer; otherwise outlined.
class StatusPill extends StatelessWidget {
  const StatusPill(this.label, {super.key, this.filled = true});

  final String label;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(
        color: filled ? scheme.secondaryContainer : null,
        border: filled ? null : Border.all(color: scheme.outline),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: filled ? scheme.onSecondaryContainer : scheme.onSurfaceVariant,
            ),
      ),
    );
  }
}
