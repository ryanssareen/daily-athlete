// lib/features/calendar/month_view.dart
//
// Month view using table_calendar in month mode.
// Each day cell shows sport-colored dot badges (up to 3).
// Tap a day → invokes onDaySelected callback (navigates to Day view).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:table_calendar/table_calendar.dart';

import '../../models/activity_summary.dart';
import 'calendar_providers.dart';
import 'workout_chip.dart';

class MonthView extends ConsumerStatefulWidget {
  const MonthView({super.key, required this.onDaySelected});

  /// Called when the user taps a calendar day. Typically navigates to DayView.
  final void Function(DateTime date) onDaySelected;

  @override
  ConsumerState<MonthView> createState() => _MonthViewState();
}

class _MonthViewState extends ConsumerState<MonthView> {
  late DateTime _focusedDay;
  DateTime? _selectedDay;

  @override
  void initState() {
    super.initState();
    _focusedDay = DateTime.now();
    _selectedDay = _dateOnly(DateTime.now());
  }

  DateTime _dateOnly(DateTime dt) =>
      DateTime.utc(dt.year, dt.month, dt.day);

  void _onPageChanged(DateTime focusedDay) {
    setState(() => _focusedDay = focusedDay);
    // Shift the week-range provider to cover the new month so the data fetch
    // encompasses the visible range (first day → last day of month).
    final firstDay =
        DateTime.utc(focusedDay.year, focusedDay.month, 1);
    final lastDay =
        DateTime.utc(focusedDay.year, focusedDay.month + 1, 0);
    ref.read(calendarWeekRangeProvider.notifier).state =
        (start: firstDay, end: lastDay);
  }

  @override
  void initState() {
    super.initState();
    // Expand the week range to cover the whole initial month.
    // Done in a post-frame callback to avoid modifying provider state
    // during the first build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final firstDay =
          DateTime.utc(_focusedDay.year, _focusedDay.month, 1);
      final lastDay =
          DateTime.utc(_focusedDay.year, _focusedDay.month + 1, 0);
      ref.read(calendarWeekRangeProvider.notifier).state =
          (start: firstDay, end: lastDay);
    });
  }

  @override
  Widget build(BuildContext context) {
    final weekDataAsync = ref.watch(calendarWeekDataProvider);

    return weekDataAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(child: Text('Error: $err')),
      data: (weekMap) => _buildCalendar(context, weekMap),
    );
  }

  Widget _buildCalendar(
      BuildContext context, Map<DateTime, List<ActivitySummary>> weekMap) {
    return TableCalendar<ActivitySummary>(
      firstDay: DateTime.utc(2020, 1, 1),
      lastDay: DateTime.utc(2030, 12, 31),
      focusedDay: _focusedDay,
      selectedDayPredicate: (day) =>
          isSameDay(_selectedDay, day),
      calendarFormat: CalendarFormat.month,
      availableCalendarFormats: const {
        CalendarFormat.month: 'Month',
      },
      startingDayOfWeek: StartingDayOfWeek.monday,
      eventLoader: (day) {
        final key = _dateOnly(day);
        return weekMap[key] ?? [];
      },
      onDaySelected: (selectedDay, focusedDay) {
        setState(() {
          _selectedDay = selectedDay;
          _focusedDay = focusedDay;
        });
        ref.read(selectedDateProvider.notifier).state =
            _dateOnly(selectedDay);
        widget.onDaySelected(_dateOnly(selectedDay));
      },
      onPageChanged: _onPageChanged,
      calendarBuilders: CalendarBuilders<ActivitySummary>(
        markerBuilder: (context, day, events) {
          if (events.isEmpty) return const SizedBox.shrink();
          // Show up to 3 dots; remainder is truncated.
          final visible = events.take(3).toList();
          return Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: visible
                .map((s) => SportDot(
                      sport: s.sport,
                      isCompleted: s.isCompleted,
                    ))
                .toList(),
          );
        },
      ),
      headerStyle: HeaderStyle(
        formatButtonVisible: false,
        titleCentered: true,
        titleTextStyle: Theme.of(context)
            .textTheme
            .titleSmall!
            .copyWith(fontWeight: FontWeight.w600),
      ),
      calendarStyle: CalendarStyle(
        todayDecoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.15),
          shape: BoxShape.circle,
        ),
        todayTextStyle: TextStyle(
          color: Theme.of(context).colorScheme.primary,
          fontWeight: FontWeight.bold,
        ),
        selectedDecoration: BoxDecoration(
          color: Theme.of(context).colorScheme.primary,
          shape: BoxShape.circle,
        ),
        markersMaxCount: 3,
        markersAlignment: Alignment.bottomCenter,
      ),
    );
  }
}
