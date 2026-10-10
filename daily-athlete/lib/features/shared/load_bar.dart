import 'package:flutter/material.dart';

/// Thin horizontal bar; [value] is 0..1 relative to the largest item.
class LoadBar extends StatelessWidget {
  const LoadBar({super.key, required this.value, this.color, this.opacity = 1});

  final double value;
  final Color? color;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ClipRRect(
      borderRadius: BorderRadius.circular(3),
      child: Stack(
        children: [
          Container(height: 6, color: scheme.surfaceContainerHighest),
          FractionallySizedBox(
            widthFactor: value.clamp(0.0, 1.0),
            child: Container(
              height: 6,
              color: (color ?? scheme.primary).withValues(alpha: opacity),
            ),
          ),
        ],
      ),
    );
  }
}
