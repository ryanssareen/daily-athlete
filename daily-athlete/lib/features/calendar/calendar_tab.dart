// lib/features/calendar/calendar_tab.dart
//
// Calendar tab root widget.
// - Segmented control: Day | 2 Weeks (default) | Month | Year
// - Coach: athlete selector at top (reads/writes calendarAthleteIdProvider)
// - Delegates to DayView, WeekView, MonthView, YearHeatmapView

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../models/user.dart';
import '../activities/manual_log_sheet.dart';
import '../shell/role_notifier.dart';
import 'calendar_providers.dart';
import 'day_view.dart';
import 'month_view.dart';
import 'week_view.dart';
import 'year_heatmap_view.dart';

// ---------------------------------------------------------------------------
// View index enum
// ---------------------------------------------------------------------------

enum _CalendarView { day, week, month, year }

// ---------------------------------------------------------------------------
// Internal athlete list for calendar selector
// ---------------------------------------------------------------------------

/// Returns [[id, displayName], ...] for athletes linked to the current coach.
final _calendarAthleteListProvider =
    FutureProvider<List<List<String>>>((ref) async {
  final supabase = Supabase.instance.client;
  final userId = supabase.auth.currentUser?.id;
  if (userId == null) return [];

  final data = await supabase
      .from('coach_athlete_links')
      .select(
          'athlete_user_id, users!athlete_user_id(id, display_name, email)')
      .eq('coach_user_id', userId)
      .eq('status', 'active')
      .isFilter('deleted_at', null);

  return (data as List<dynamic>).map((row) {
    final user = row['users'] as Map<String, dynamic>? ?? {};
    final id = user['id'] as String? ??
        row['athlete_user_id'] as String;
    final name = user['display_name'] as String? ??
        user['email'] as String? ??
        id;
    return [id, name];
  }).toList();
});

// ---------------------------------------------------------------------------
// CalendarTab
// ---------------------------------------------------------------------------

class CalendarTab extends ConsumerStatefulWidget {
  const CalendarTab({super.key});

  @override
  ConsumerState<CalendarTab> createState() => _CalendarTabState();
}

class _CalendarTabState extends ConsumerState<CalendarTab> {
  _CalendarView _currentView = _CalendarView.week;

  void _switchToDay(DateTime date) {
    final normalised = DateTime.utc(date.year, date.month, date.day);
    ref.read(selectedDateProvider.notifier).state = normalised;

    // Ensure the two-week range covers the selected date (starts on the
    // Monday of the selected date's week, spanning 14 days).
    final weekday = date.weekday;
    final monday = date.subtract(Duration(days: weekday - 1));
    final start = DateTime.utc(monday.year, monday.month, monday.day);
    final end = start.add(const Duration(days: 13));
    ref.read(calendarWeekRangeProvider.notifier).state =
        (start: start, end: end);

    setState(() => _currentView = _CalendarView.day);
  }

  @override
  Widget build(BuildContext context) {
    final roleAsync = ref.watch(roleNotifierProvider);
    final isCoach = roleAsync.valueOrNull == RoleFlag.coach;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Calendar'),
        centerTitle: false,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(52),
          child: _ViewSwitcher(
            current: _currentView,
            onChanged: (v) => setState(() => _currentView = v),
          ),
        ),
        actions: isCoach
            ? [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: const _CalendarAthleteSelector(),
                ),
              ]
            : null,
      ),
      // Athletes log their own workouts; a coach viewing athletes' calendars
      // has no personal workout to log here.
      floatingActionButton: isCoach
          ? null
          : FloatingActionButton(
              onPressed: () => showManualLogSheet(context),
              tooltip: 'Log activity',
              child: const Icon(Icons.add),
            ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    switch (_currentView) {
      case _CalendarView.day:
        return DayView(date: ref.read(selectedDateProvider));
      case _CalendarView.week:
        return WeekView(onDayTapped: _switchToDay);
      case _CalendarView.month:
        return MonthView(onDaySelected: _switchToDay);
      case _CalendarView.year:
        return const YearHeatmapView();
    }
  }
}

// ---------------------------------------------------------------------------
// _CalendarAthleteSelector
//
// Inline dropdown scoped to calendarAthleteIdProvider (separate from the
// Activities tab's selectedAthleteIdProvider so they don't cross-contaminate).
// ---------------------------------------------------------------------------

class _CalendarAthleteSelector extends ConsumerWidget {
  const _CalendarAthleteSelector();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectedId = ref.watch(calendarAthleteIdProvider);
    final athletesAsync = ref.watch(_calendarAthleteListProvider);

    return athletesAsync.when(
      loading: () => const SizedBox(
        height: 36,
        width: 36,
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      ),
      error: (_, __) => const SizedBox.shrink(),
      data: (list) {
        if (list.isEmpty) return const SizedBox.shrink();

        final items = <DropdownMenuItem<String?>>[
          const DropdownMenuItem(value: null, child: Text('All athletes')),
          ...list.map(
            (pair) =>
                DropdownMenuItem(value: pair[0], child: Text(pair[1])),
          ),
        ];

        return DropdownButton<String?>(
          value: selectedId,
          items: items,
          onChanged: (id) =>
              ref.read(calendarAthleteIdProvider.notifier).state = id,
          underline: const SizedBox.shrink(),
          icon: const Icon(Icons.arrow_drop_down),
        );
      },
    );
  }
}

// ---------------------------------------------------------------------------
// _ViewSwitcher — segmented control for Day | Week | Month | Year
// ---------------------------------------------------------------------------

class _ViewSwitcher extends StatelessWidget {
  const _ViewSwitcher({
    required this.current,
    required this.onChanged,
  });

  final _CalendarView current;
  final void Function(_CalendarView) onChanged;

  static const _labels = ['Day', '2 Weeks', 'Month', 'Year'];
  static const _views = [
    _CalendarView.day,
    _CalendarView.week,
    _CalendarView.month,
    _CalendarView.year,
  ];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    // The app bar is brand red with white foreground, so the default
    // SegmentedButton (dark outline / dark text) would be near-invisible.
    // Style it for the red surface: white selected fill with red text, and
    // a translucent white track for the unselected segments.
    final onRed = theme.appBarTheme.foregroundColor ?? Colors.white;
    final redFill = theme.appBarTheme.backgroundColor ?? theme.colorScheme.primary;

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
      child: SegmentedButton<_CalendarView>(
        showSelectedIcon: false,
        segments: List.generate(
          _views.length,
          (i) => ButtonSegment<_CalendarView>(
            value: _views[i],
            label: Text(_labels[i]),
          ),
        ),
        selected: {current},
        onSelectionChanged: (Set<_CalendarView> selected) {
          if (selected.isNotEmpty) onChanged(selected.first);
        },
        style: ButtonStyle(
          visualDensity: VisualDensity.compact,
          textStyle: WidgetStatePropertyAll(
            theme.textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w600),
          ),
          // Translucent white track behind unselected; solid white when picked.
          backgroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.selected)) return onRed;
            return onRed.withValues(alpha: 0.14);
          }),
          // Selected text uses the red, unselected stays white.
          foregroundColor: WidgetStateProperty.resolveWith((states) {
            if (states.contains(WidgetState.selected)) return redFill;
            return onRed;
          }),
          overlayColor: WidgetStatePropertyAll(
            onRed.withValues(alpha: 0.12),
          ),
          side: WidgetStatePropertyAll(
            BorderSide(color: onRed.withValues(alpha: 0.30)),
          ),
          shape: const WidgetStatePropertyAll(
            RoundedRectangleBorder(
              borderRadius: BorderRadius.all(Radius.circular(10)),
            ),
          ),
        ),
      ),
    );
  }
}
