// lib/features/calendar/week_month_header.dart
//
// Phone calendar header: shows the current week as a single row and expands
// into the full month when dragged down (or tapped on the handle). Picking a
// day points the agenda below at that day's week.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:table_calendar/table_calendar.dart';

import '../../models/activity_summary.dart';
import 'calendar_providers.dart';
import 'workout_chip.dart';

DateTime _utcDay(DateTime d) => DateTime.utc(d.year, d.month, d.day);

class WeekMonthHeader extends ConsumerStatefulWidget {
  const WeekMonthHeader({super.key, required this.onDaySelected});

  /// Called after a day is picked, with its UTC date.
  final ValueChanged<DateTime> onDaySelected;

  @override
  ConsumerState<WeekMonthHeader> createState() => _WeekMonthHeaderState();
}

class _WeekMonthHeaderState extends ConsumerState<WeekMonthHeader> {
  CalendarFormat _format = CalendarFormat.week;
  late DateTime _focusedDay = _utcDay(DateTime.now());

  bool get _expanded => _format == CalendarFormat.month;

  void _setFormat(CalendarFormat f) {
    if (f == _format) return;
    setState(() {
      // Open the month grid on the month of the week being viewed.
      if (f == CalendarFormat.month) {
        _focusedDay = _utcDay(ref.read(selectedDateProvider));
      }
      _format = f;
    });
  }

  void _setWeekFor(DateTime day) {
    final monday = day.subtract(Duration(days: day.weekday - 1));
    final start = _utcDay(monday);
    ref.read(calendarWeekRangeProvider.notifier).state = (
      start: start,
      end: start.add(const Duration(days: 6)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final range = ref.watch(calendarWeekRangeProvider);
    final selected = ref.watch(selectedDateProvider);

    // Collapsed: follow the agenda's week (chevrons live in the nav card).
    final focused = _expanded
        ? _focusedDay
        : (selected.isBefore(range.start) || selected.isAfter(range.end)
              ? range.start
              : selected);
    final markers = ref
        .watch(
          calendarMarkersProvider(
            DateTime.utc(focused.year, focused.month, 1),
          ),
        )
        .valueOrNull;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onVerticalDragEnd: (d) {
        final v = d.primaryVelocity ?? 0;
        if (v > 150) _setFormat(CalendarFormat.month);
        if (v < -150) _setFormat(CalendarFormat.week);
      },
      child: Column(
        children: [
          TableCalendar<ActivitySummary>(
            firstDay: DateTime.utc(2020, 1, 1),
            lastDay: DateTime.utc(2030, 12, 31),
            focusedDay: focused,
            calendarFormat: _format,
            availableCalendarFormats: const {
              CalendarFormat.month: 'Month',
              CalendarFormat.week: 'Week',
            },
            availableGestures: AvailableGestures.horizontalSwipe,
            startingDayOfWeek: StartingDayOfWeek.monday,
            rowHeight: 44,
            daysOfWeekHeight: 20,
            headerVisible: _expanded,
            headerStyle: HeaderStyle(
              formatButtonVisible: false,
              titleCentered: true,
              titleTextStyle: Theme.of(context).textTheme.titleSmall!.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            selectedDayPredicate: (day) => isSameDay(selected, day),
            eventLoader: (day) => markers?[_utcDay(day)] ?? const [],
            onDaySelected: (day, focusedDay) {
              final d = _utcDay(day);
              setState(() => _focusedDay = d);
              ref.read(selectedDateProvider.notifier).state = d;
              _setWeekFor(d);
              widget.onDaySelected(d);
            },
            onPageChanged: (day) {
              setState(() => _focusedDay = _utcDay(day));
              // Week paging moves the agenda; month paging only moves the grid.
              if (!_expanded) {
                _setWeekFor(day);
                ref.read(selectedDateProvider.notifier).state = _utcDay(day);
              }
            },
            calendarBuilders: CalendarBuilders<ActivitySummary>(
              markerBuilder: (context, day, events) {
                if (events.isEmpty) return const SizedBox.shrink();
                return Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (final s in events.take(3))
                      SportDot(sport: s.sport, isCompleted: s.isCompleted),
                  ],
                );
              },
            ),
            calendarStyle: CalendarStyle(
              outsideDaysVisible: _expanded,
              todayDecoration: BoxDecoration(
                color: scheme.primary.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              todayTextStyle: TextStyle(
                color: scheme.primary,
                fontWeight: FontWeight.bold,
              ),
              selectedDecoration: BoxDecoration(
                color: scheme.primary,
                shape: BoxShape.circle,
              ),
              markersMaxCount: 3,
              markersAlignment: Alignment.bottomCenter,
            ),
          ),
          InkWell(
            onTap: () => _setFormat(
              _expanded ? CalendarFormat.week : CalendarFormat.month,
            ),
            child: Semantics(
              button: true,
              label: _expanded ? 'Collapse to week' : 'Expand to month',
              child: SizedBox(
                height: 20,
                child: Center(
                  child: Container(
                    width: 36,
                    height: 4,
                    decoration: BoxDecoration(
                      color: scheme.outlineVariant,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
