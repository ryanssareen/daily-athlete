import 'package:flutter/material.dart';

import '../../models/sport.dart';

IconData sportIcon(Sport sport) {
  return switch (sport) {
    Sport.swim => Icons.pool,
    Sport.bike => Icons.directions_bike,
    Sport.run => Icons.directions_run,
    Sport.strength => Icons.fitness_center,
    Sport.mobility => Icons.self_improvement,
    Sport.other => Icons.sports,
  };
}

/// Rounded square with the sport icon, tinted at 12% of the sport color.
class SportTile extends StatelessWidget {
  const SportTile({super.key, required this.sport, this.size = 36});

  final Sport sport;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: sport.color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Icon(sportIcon(sport), size: size * 0.55, color: sport.color),
    );
  }
}
