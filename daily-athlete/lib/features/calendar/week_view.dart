// lib/features/calendar/week_view.dart
//
// Week view: a navigation card (chevrons, day strip, week total) above a
// vertical agenda grouped by day. Consecutive empty past days collapse into a
// dashed "Rest · N days" row. Completed workouts are solid cards; planned ones
// have a dashed sport-colored border and no fill.
//
// Tap a workout -> its detail. Long-press a planned workout -> WorkoutActionSheet.
// Coach: tap an empty day -> AssignWorkoutSheet. Tap a day in the strip ->
// scroll to that day.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/da_theme.dart';
import '../../models/activity_summary.dart';
import '../../models/user.dart';
import '../dashboard/home_format.dart';
import '../settings/distance_format.dart';
import '../settings/units_notifier.dart';
import '../shared/day_strip.dart';
import '../shared/eyebrow.dart';
import '../shared/sport_tile.dart';
import '../shell/role_notifier.dart';
import 'assign_workout_sheet.dart';
import 'calendar_providers.dart';
import 'week_agenda.dart';
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
    final isCoach = ref.watch(roleNotifierProvider).valueOrNull == RoleFlag.coach;
    final days = List.generate(7, (i) => range.start.add(Duration(days: i)));

    return weekDataAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
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
        ...(widget.weekMap[DateTime.utc(d.year, d.month, d.day)] ?? const <ActivitySummary>[])
            .where((s) => s.isCompleted),
    ];
    final totalS = completed.fold<int>(0, (a, s) => a + (s.completed!.durationS ?? 0));
    final totalM = completed.fold<double>(0, (a, s) => a + (s.completed!.distanceM ?? 0));
    final strip = [
      for (var i = 0; i < 7; i++)
        DayStripDay(
          letter: 'MTWTFSS'[i],
          dayNumber: widget.days[i].day,
          isToday: _isSameDay(widget.days[i], now),
          sports: [
            for (final s in widget.weekMap[DateTime.utc(
                  widget.days[i].year,
                  widget.days[i].month,
                  widget.days[i].day,
                )] ??
                const <ActivitySummary>[])
              s.sport,
          ].toSet().toList(),
        ),
    ];
    final blocks = buildAgenda(widget.days, widget.weekMap, now);

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
      children: [
        _WeekNavCard(
          range: widget.range,
          strip: strip,
          onDayTapped: _scrollTo,
          totalLine:
              '${completed.length} sessions · ${fmtHm(totalS)} · ${formatDistanceM(totalM, unit)}',
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

  bool _isSameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;
}

class _WeekNavCard extends ConsumerWidget {
  const _WeekNavCard({
    required this.range,
    required this.strip,
    required this.onDayTapped,
    required this.totalLine,
  });

  final ({DateTime start, DateTime end}) range;
  final List<DayStripDay> strip;
  final ValueChanged<int> onDayTapped;
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
            DayStrip(days: strip, onTap: onDayTapped),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Row(
                children: [
                  Text(
                    'WEEK TOTAL',
                    style: context.da.eyebrow.copyWith(color: scheme.onSurfaceVariant),
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
      child: CustomPaint(
        painter: _DashedBorderPainter(color: scheme.outlineVariant, radius: 12),
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
                  style: context.da.eyebrow.copyWith(color: scheme.onSurfaceVariant),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'Rest · ${rest.count} ${rest.count == 1 ? 'day' : 'days'}',
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: scheme.onSurfaceVariant),
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
    final isToday = day.date.year == now.year && day.date.month == now.month && day.date.day == now.day;
    final done = day.workouts.where((s) => s.isCompleted).toList();
    final doneS = done.fold<int>(0, (a, s) => a + (s.completed!.durationS ?? 0));
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
                Text('${done.length} · ${fmtHm(doneS)}', style: context.da.metric),
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
                  isCoach ? 'Nothing planned. Tap to assign.' : 'Nothing planned.',
                  style: Theme.of(context)
                      .textTheme
                      .bodyMedium
                      ?.copyWith(color: scheme.onSurfaceVariant),
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
                  style: textTheme.titleMedium,
                ),
                if (isPlannedOnly)
                  Text('Planned', style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant)),
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
                    style: textTheme.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
                  ),
              ],
            ),
        ],
      ),
    );

    void onTap() {
      if (cw != null) {
        context.go('/activities/${cw.id}');
      } else if (planned != null) {
        context.go('/calendar/${planned.id}');
      }
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: GestureDetector(
        onLongPress: isPlannedOnly
            ? () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  builder: (_) => WorkoutActionSheet(workout: planned),
                )
            : null,
        child: isPlannedOnly
            ? CustomPaint(
                painter: _DashedBorderPainter(color: summary.sport.color, radius: 16),
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

class _DashedBorderPainter extends CustomPainter {
  _DashedBorderPainter({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    final path = Path()
      ..addRRect(RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(radius)));
    for (final metric in path.computeMetrics()) {
      var distance = 0.0;
      while (distance < metric.length) {
        canvas.drawPath(metric.extractPath(distance, distance + 6), paint);
        distance += 10;
      }
    }
  }

  @override
  bool shouldRepaint(_DashedBorderPainter old) => old.color != color || old.radius != radius;
}
