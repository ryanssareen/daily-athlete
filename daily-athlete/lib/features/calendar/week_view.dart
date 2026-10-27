// lib/features/calendar/week_view.dart
//
// Week view: a navigation card (chevrons, week/month header, week total) above a
// vertical agenda grouped by day. Consecutive empty past days collapse into a
// dashed "Rest · N days" row. Completed workouts are solid cards; planned ones
// have a dashed sport-colored border and no fill.
//
// Tap a workout -> its detail. Long-press a planned workout -> WorkoutActionSheet.
// Coach: tap an empty day -> AssignWorkoutSheet. Tap a day in the header ->
// scroll to that day.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/da_theme.dart';
import '../../models/activity_summary.dart';
import '../../models/planned_workout.dart';
import '../../models/user.dart';
import '../dashboard/home_format.dart';
import '../settings/distance_format.dart';
import '../settings/units_notifier.dart';
import '../shared/dashed_border.dart';
import '../shared/eyebrow.dart';
import '../shared/skeleton.dart';
import '../shared/sport_tile.dart';
import '../shell/role_notifier.dart';
import 'assign_workout_sheet.dart';
import 'calendar_providers.dart';
import 'week_agenda.dart';
import 'week_month_header.dart';
import 'workout_action_sheet.dart';

class WeekView extends ConsumerWidget {
  const WeekView({super.key, required this.onDayTapped});

  /// Kept for the tab's API; the agenda scrolls in place instead of switching
  /// to Day view.
  final void Function(DateTime date) onDayTapped;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final range = ref.watch(calendarWeekRangeProvider);
    final weekDataAsync = ref.watch(calendarWeekDataProvider);
    final isCoach =
        ref.watch(roleNotifierProvider).valueOrNull == RoleFlag.coach;
    final days = List.generate(7, (i) => range.start.add(Duration(days: i)));

    return weekDataAsync.when(
      loading: () => const CalendarAgendaSkeleton(),
      error: (err, _) => Center(child: Text('Error: $err')),
      data: (weekMap) => _WeekAgenda(
        range: range,
        days: days,
        weekMap: weekMap,
        isCoach: isCoach,
      ),
    );
  }
}

class _WeekAgenda extends ConsumerStatefulWidget {
  const _WeekAgenda({
    required this.range,
    required this.days,
    required this.weekMap,
    required this.isCoach,
  });

  final ({DateTime start, DateTime end}) range;
  final List<DateTime> days;
  final Map<DateTime, List<ActivitySummary>> weekMap;
  final bool isCoach;

  @override
  ConsumerState<_WeekAgenda> createState() => _WeekAgendaState();
}

class _WeekAgendaState extends ConsumerState<_WeekAgenda> {
  final _keys = List.generate(7, (_) => GlobalKey());

  void _scrollTo(int dayIndex) {
    final ctx = _keys[dayIndex].currentContext;
    if (ctx != null) {
      Scrollable.ensureVisible(
        ctx,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final unit = ref.watch(unitsNotifierProvider).valueOrNull?.distance ?? 'km';
    final completed = [
      for (final d in widget.days)
        ...(widget.weekMap[DateTime.utc(d.year, d.month, d.day)] ??
                const <ActivitySummary>[])
            .where((s) => s.isCompleted),
    ];
    final totalS = completed.fold<int>(
      0,
      (a, s) => a + (s.completed!.durationS ?? 0),
    );
    final totalM = completed.fold<double>(
      0,
      (a, s) => a + (s.completed!.distanceM ?? 0),
    );
    final blocks = buildAgenda(widget.days, widget.weekMap, now);
    final totalLine =
        '${completed.length} sessions · ${fmtHm(totalS)} · ${formatDistanceM(totalM, unit)}';

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= _gridMinWidth) {
          return _WeekGrid(
            range: widget.range,
            days: widget.days,
            weekMap: widget.weekMap,
            now: now,
            isCoach: widget.isCoach,
            unit: unit,
            totalLine: totalLine,
          );
        }
        return _buildAgendaList(blocks, now, unit, totalLine);
      },
    );
  }

  Widget _buildAgendaList(
    List<AgendaBlock> blocks,
    DateTime now,
    String unit,
    String totalLine,
  ) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      children: [
        _WeekNavCard(
          range: widget.range,
          header: WeekMonthHeader(
            onDaySelected: (d) {
              // Wait a frame so the agenda has rebuilt for the new week.
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (!mounted) return;
                final i = d.difference(widget.days.first).inDays;
                if (i >= 0 && i <= 6) _scrollTo(i);
              });
            },
          ),
          totalLine: totalLine,
        ),
        const SizedBox(height: 16),
        for (final block in blocks)
          switch (block) {
            AgendaRest() => _RestRow(key: _keys[block.firstIndex], rest: block),
            AgendaDay() => _DaySection(
              key: _keys[block.index],
              day: block,
              now: now,
              isCoach: widget.isCoach,
              unit: unit,
            ),
          },
      ],
    );
  }
}

class _WeekNavCard extends ConsumerWidget {
  const _WeekNavCard({
    required this.range,
    this.header,
    required this.totalLine,
  });

  final ({DateTime start, DateTime end}) range;

  /// Omitted in the grid layout, where the columns already show the days.
  final Widget? header;
  final String totalLine;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 12),
        child: Column(
          children: [
            Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.chevron_left),
                  tooltip: 'Previous week',
                  onPressed: () => _shiftWeek(ref, -7),
                ),
                Expanded(
                  child: Text(
                    _weekLabel(range.start, range.end),
                    textAlign: TextAlign.center,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.chevron_right),
                  tooltip: 'Next week',
                  onPressed: () => _shiftWeek(ref, 7),
                ),
              ],
            ),
            if (header != null) header!,
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Row(
                children: [
                  Text(
                    'WEEK TOTAL',
                    style: context.da.eyebrow.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      totalLine,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.end,
                      style: context.da.metric,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _shiftWeek(WidgetRef ref, int days) {
    final current = ref.read(calendarWeekRangeProvider);
    ref.read(calendarWeekRangeProvider.notifier).state = (
      start: current.start.add(Duration(days: days)),
      end: current.end.add(Duration(days: days)),
    );
  }

  String _weekLabel(DateTime start, DateTime end) {
    final fmt = DateFormat('MMM d');
    if (start.month == end.month) {
      return '${DateFormat('MMM').format(start)} ${start.day} – ${end.day}, ${start.year}';
    }
    return '${fmt.format(start)} – ${fmt.format(end)}, ${start.year}';
  }
}

class _RestRow extends StatelessWidget {
  const _RestRow({super.key, required this.rest});

  final AgendaRest rest;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final first = rest.dates.first;
    final last = rest.dates.last;
    final range = rest.count == 1
        ? fmtDayDate(first).split(' ').first.toUpperCase() + ' ${first.day}'
        : '${DateFormat.E().format(first).toUpperCase()} ${first.day} – ${DateFormat.E().format(last).toUpperCase()} ${last.day}';
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: DashedBorder(
        color: context.da.outlineStrong,
        radius: 12,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  range,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: context.da.eyebrow.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'Rest · ${rest.count} ${rest.count == 1 ? 'day' : 'days'}',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DaySection extends StatelessWidget {
  const _DaySection({
    super.key,
    required this.day,
    required this.now,
    required this.isCoach,
    required this.unit,
  });

  final AgendaDay day;
  final DateTime now;
  final bool isCoach;
  final String unit;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isToday =
        day.date.year == now.year &&
        day.date.month == now.month &&
        day.date.day == now.day;
    final done = day.workouts.where((s) => s.isCompleted).toList();
    final doneS = done.fold<int>(
      0,
      (a, s) => a + (s.completed!.durationS ?? 0),
    );
    final dow = DateFormat.E().format(day.date).toUpperCase();
    final title = '$dow ${day.date.day}${isToday ? ' · TODAY' : ''}';

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Eyebrow(title)),
              if (done.isNotEmpty)
                Text(
                  '${done.length} · ${fmtHm(doneS)}',
                  style: context.da.metric,
                ),
            ],
          ),
          const SizedBox(height: 8),
          if (day.workouts.isEmpty)
            InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: isCoach
                  ? () => showModalBottomSheet<void>(
                      context: context,
                      isScrollControlled: true,
                      builder: (_) => AssignWorkoutSheet(date: day.date),
                    )
                  : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  isCoach
                      ? 'Nothing planned. Tap to assign.'
                      : 'Nothing planned.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            )
          else
            for (final s in day.workouts) _WorkoutRow(summary: s, unit: unit),
        ],
      ),
    );
  }
}

class _WorkoutRow extends StatelessWidget {
  const _WorkoutRow({required this.summary, required this.unit});

  final ActivitySummary summary;
  final String unit;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    final planned = summary.planned;
    final isPlannedOnly = planned != null && !summary.isCompleted;
    final cw = summary.completed;

    final row = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      child: Row(
        children: [
          SportTile(sport: summary.sport),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  summary.sport.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (isPlannedOnly)
                  Text(
                    'Planned',
                    style: textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          if (cw != null)
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(fmtHm(cw.durationS ?? 0), style: context.da.metric),
                if ((cw.distanceM ?? 0) > 0)
                  Text(
                    formatDistanceM(cw.distanceM!, unit),
                    style: context.da.metricSmall.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
              ],
            ),
        ],
      ),
    );

    void onTap() => _openSummary(context, summary);

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: GestureDetector(
        onLongPress: isPlannedOnly
            ? () => _showPlannedActions(context, planned)
            : null,
        child: isPlannedOnly
            ? DashedBorder(
                color: summary.sport.color,
                radius: 16,
                child: InkWell(
                  borderRadius: BorderRadius.circular(16),
                  onTap: onTap,
                  child: row,
                ),
              )
            : Card(
                margin: EdgeInsets.zero,
                clipBehavior: Clip.antiAlias,
                child: InkWell(onTap: onTap, child: row),
              ),
      ),
    );
  }
}

void _openSummary(BuildContext context, ActivitySummary summary) {
  final cw = summary.completed;
  final planned = summary.planned;
  if (cw != null) {
    context.go('/activities/${cw.id}');
  } else if (planned != null) {
    context.go('/calendar/${planned.id}');
  }
}

void _showPlannedActions(BuildContext context, PlannedWorkoutRow planned) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (_) => WorkoutActionSheet(workout: planned),
  );
}

/// Narrowest pane that still fits seven readable day columns (~60px each).
const double _gridMinWidth = 460;

/// Tablet week: seven day columns side by side instead of a vertical agenda.
class _WeekGrid extends StatelessWidget {
  const _WeekGrid({
    required this.range,
    required this.days,
    required this.weekMap,
    required this.now,
    required this.isCoach,
    required this.unit,
    required this.totalLine,
  });

  final ({DateTime start, DateTime end}) range;
  final List<DateTime> days;
  final Map<DateTime, List<ActivitySummary>> weekMap;
  final DateTime now;
  final bool isCoach;
  final String unit;
  final String totalLine;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      children: [
        _WeekNavCard(range: range, totalLine: totalLine),
        const SizedBox(height: 16),
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (var i = 0; i < 7; i++) ...[
                if (i > 0) const SizedBox(width: 6),
                Expanded(
                  child: _GridDay(
                    date: days[i],
                    workouts:
                        weekMap[DateTime.utc(
                          days[i].year,
                          days[i].month,
                          days[i].day,
                        )] ??
                        const <ActivitySummary>[],
                    now: now,
                    isCoach: isCoach,
                    unit: unit,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _GridDay extends StatelessWidget {
  const _GridDay({
    required this.date,
    required this.workouts,
    required this.now,
    required this.isCoach,
    required this.unit,
  });

  final DateTime date;
  final List<ActivitySummary> workouts;
  final DateTime now;
  final bool isCoach;
  final String unit;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(date.year, date.month, date.day);
    final isToday = day == today;
    final isPast = day.isBefore(today);

    return Container(
      constraints: const BoxConstraints(minHeight: 320),
      padding: const EdgeInsets.fromLTRB(6, 10, 6, 10),
      decoration: BoxDecoration(
        color: isToday ? scheme.surfaceContainerLow : scheme.surfaceContainer,
        borderRadius: BorderRadius.circular(14),
        border: isToday ? Border.all(color: context.da.clay, width: 1.5) : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            DateFormat.E().format(date),
            textAlign: TextAlign.center,
            maxLines: 1,
            style: Theme.of(
              context,
            ).textTheme.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 4),
          Center(
            child: Container(
              width: 32,
              height: 32,
              alignment: Alignment.center,
              decoration: isToday
                  ? BoxDecoration(
                      color: context.da.clay,
                      shape: BoxShape.circle,
                    )
                  : null,
              child: Text(
                '${date.day}',
                style: context.da.metric.copyWith(
                  color: isToday ? Colors.white : scheme.onSurface,
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          if (workouts.isEmpty)
            _GridEmpty(date: date, isCoach: isCoach, isPast: isPast)
          else
            for (final s in workouts) _GridCell(summary: s),
        ],
      ),
    );
  }
}

class _GridEmpty extends StatelessWidget {
  const _GridEmpty({
    required this.date,
    required this.isCoach,
    required this.isPast,
  });

  final DateTime date;
  final bool isCoach;
  final bool isPast;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final label = Text(
      isCoach ? 'Assign' : (isPast ? 'Rest' : '—'),
      textAlign: TextAlign.center,
      style: Theme.of(
        context,
      ).textTheme.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
    );
    if (!isCoach) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: label,
      );
    }
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: () => showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (_) => AssignWorkoutSheet(date: date),
      ),
      child: DashedBorder(
        color: context.da.outlineStrong,
        radius: 10,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: label,
        ),
      ),
    );
  }
}

class _GridCell extends StatelessWidget {
  const _GridCell({required this.summary});

  final ActivitySummary summary;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final planned = summary.planned;
    final isPlannedOnly = planned != null && !summary.isCompleted;
    final cw = summary.completed;
    final sport = summary.sport;

    final content = Padding(
      padding: const EdgeInsets.all(8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(sportIcon(sport), size: 16, color: sport.color),
          const SizedBox(height: 4),
          Text(
            sport.displayName,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(
              context,
            ).textTheme.labelMedium?.copyWith(fontWeight: FontWeight.w500),
          ),
          Text(
            cw != null ? fmtHm(cw.durationS ?? 0) : 'Planned',
            maxLines: 1,
            style: context.da.metricSmall.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );

    final tile = isPlannedOnly
        ? DashedBorder(
            color: sport.color,
            radius: 10,
            child: InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: () => _openSummary(context, summary),
              child: content,
            ),
          )
        : Material(
            color: sport.color.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(10),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => _openSummary(context, summary),
              child: content,
            ),
          );

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: GestureDetector(
        onLongPress: isPlannedOnly
            ? () => _showPlannedActions(context, planned)
            : null,
        child: tile,
      ),
    );
  }
}
