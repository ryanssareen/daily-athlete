import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Decodes a Google/Strava encoded polyline (precision 5) into lat/lng pairs.
/// Returns an empty list for malformed input rather than throwing — the map
/// is decoration and must never take the detail screen down.
List<({double lat, double lng})> decodePolyline(String encoded) {
  final points = <({double lat, double lng})>[];
  var index = 0;
  var lat = 0;
  var lng = 0;

  int? readValue() {
    var result = 0;
    var shift = 0;
    while (true) {
      if (index >= encoded.length) return null;
      final b = encoded.codeUnitAt(index++) - 63;
      if (b < 0) return null;
      result |= (b & 0x1f) << shift;
      shift += 5;
      if (b < 0x20) break;
    }
    return (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
  }

  while (index < encoded.length) {
    final dLat = readValue();
    final dLng = readValue();
    if (dLat == null || dLng == null) return const [];
    lat += dLat;
    lng += dLng;
    points.add((lat: lat / 1e5, lng: lng / 1e5));
  }
  return points;
}

/// Route shape drawn from Strava's summary polyline. Painted directly (no map
/// tiles) so it needs no API key, works offline, and adds no dependency.
class RouteMapCard extends StatelessWidget {
  const RouteMapCard({super.key, required this.polyline});

  final String polyline;

  @override
  Widget build(BuildContext context) {
    final points = decodePolyline(polyline);
    if (points.length < 2) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Route', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 12),
            AspectRatio(
              aspectRatio: 4 / 3,
              child: Semantics(
                label: 'Route map',
                child: CustomPaint(
                  painter: _RoutePainter(
                    points: points,
                    lineColor: scheme.primary,
                    startColor: Colors.green.shade600,
                    endColor: scheme.error,
                    backgroundColor: scheme.surfaceContainerHighest,
                  ),
                  size: Size.infinite,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RoutePainter extends CustomPainter {
  _RoutePainter({
    required this.points,
    required this.lineColor,
    required this.startColor,
    required this.endColor,
    required this.backgroundColor,
  });

  final List<({double lat, double lng})> points;
  final Color lineColor;
  final Color startColor;
  final Color endColor;
  final Color backgroundColor;

  static const double _padding = 20;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRRect(
      RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(12)),
      Paint()..color = backgroundColor,
    );

    var minLat = points.first.lat, maxLat = points.first.lat;
    var minLng = points.first.lng, maxLng = points.first.lng;
    for (final p in points) {
      minLat = math.min(minLat, p.lat);
      maxLat = math.max(maxLat, p.lat);
      minLng = math.min(minLng, p.lng);
      maxLng = math.max(maxLng, p.lng);
    }

    // Longitude degrees shrink with latitude; scale so the shape isn't
    // stretched east-west.
    final midLat = (minLat + maxLat) / 2;
    final lngScale = math.cos(midLat * math.pi / 180);
    final width = (maxLng - minLng) * lngScale;
    final height = maxLat - minLat;
    if (width <= 0 && height <= 0) return;

    final availW = size.width - _padding * 2;
    final availH = size.height - _padding * 2;
    final scale = math.min(
      width > 0 ? availW / width : double.infinity,
      height > 0 ? availH / height : double.infinity,
    );
    final offsetX = (size.width - width * scale) / 2;
    final offsetY = (size.height - height * scale) / 2;

    Offset project(({double lat, double lng}) p) => Offset(
          offsetX + (p.lng - minLng) * lngScale * scale,
          offsetY + (maxLat - p.lat) * scale,
        );

    final path = Path()..moveTo(project(points.first).dx, project(points.first).dy);
    for (final p in points.skip(1)) {
      final o = project(p);
      path.lineTo(o.dx, o.dy);
    }

    canvas.drawPath(
      path,
      Paint()
        ..color = lineColor
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round,
    );

    for (final entry in [(points.first, startColor), (points.last, endColor)]) {
      final o = project(entry.$1);
      canvas.drawCircle(o, 6, Paint()..color = Colors.white);
      canvas.drawCircle(o, 4, Paint()..color = entry.$2);
    }
  }

  @override
  bool shouldRepaint(_RoutePainter old) =>
      old.points != points ||
      old.lineColor != lineColor ||
      old.backgroundColor != backgroundColor;
}
