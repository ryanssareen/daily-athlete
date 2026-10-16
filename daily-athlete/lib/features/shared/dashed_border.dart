import 'package:flutter/material.dart';

/// Draws a dashed rounded outline around [child] (planned / future / rest).
class DashedBorder extends StatelessWidget {
  const DashedBorder({
    super.key,
    required this.color,
    required this.child,
    this.radius = 12,
    this.strokeWidth = 1,
  });

  final Color color;
  final double radius;
  final double strokeWidth;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      painter: _DashedPainter(color: color, radius: radius, strokeWidth: strokeWidth),
      child: child,
    );
  }
}

class _DashedPainter extends CustomPainter {
  _DashedPainter({required this.color, required this.radius, required this.strokeWidth});

  final Color color;
  final double radius;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth;
    final inset = strokeWidth / 2;
    final rect = Rect.fromLTWH(inset, inset, size.width - strokeWidth, size.height - strokeWidth);
    final path = Path()..addRRect(RRect.fromRectAndRadius(rect, Radius.circular(radius)));
    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        canvas.drawPath(metric.extractPath(distance, distance + 5), paint);
        distance += 8;
      }
    }
  }

  @override
  bool shouldRepaint(_DashedPainter old) =>
      old.color != color || old.radius != radius || old.strokeWidth != strokeWidth;
}
