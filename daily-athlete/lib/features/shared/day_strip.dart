import 'package:flutter/material.dart';

import '../../core/da_theme.dart';
import '../../models/sport.dart';
import 'dashed_border.dart';

class DayStripDay {
  const DayStripDay({
    required this.letter,
    required this.dayNumber,
    this.sports = const [],
    this.isToday = false,
    this.isFuture = false,
  });

  final String letter;
  final int dayNumber;
  final List<Sport> sports;
  final bool isToday;
  final bool isFuture;
}

/// Seven-day row: weekday letter, date number and a dot per sport done.
class DayStrip extends StatelessWidget {
  const DayStrip({super.key, required this.days, this.onTap});

  final List<DayStripDay> days;
  final ValueChanged<int>? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Row(
      children: [
        for (var i = 0; i < days.length; i++)
          Expanded(
            child: InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: onTap == null ? null : () => onTap!(i),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        days[i].letter,
                        style: context.da.eyebrow.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ),
                    const SizedBox(height: 4),
                    DashedBorder(
                      color: days[i].isFuture ? context.da.outlineStrong : Colors.transparent,
                      radius: 14,
                      child: Container(
                        width: 28,
                        height: 28,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: days[i].isToday ? context.da.clay : null,
                        ),
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            '${days[i].dayNumber}',
                            style: context.da.metric.copyWith(
                              color: days[i].isToday ? scheme.onPrimary : scheme.onSurface,
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 4),
                    SizedBox(
                      height: 6,
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          for (final s in days[i].sports.take(3))
                            Container(
                              width: 5,
                              height: 5,
                              margin: const EdgeInsets.symmetric(horizontal: 1),
                              decoration: BoxDecoration(shape: BoxShape.circle, color: s.color),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}
