import 'package:daily_athlete/features/calendar/week_agenda.dart';
import 'package:daily_athlete/models/activity_summary.dart';
import 'package:daily_athlete/models/sport.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final monday = DateTime(2026, 10, 5);
  final days = List.generate(7, (i) => monday.add(Duration(days: i)));
  ActivitySummary summary(DateTime d) => ActivitySummary(date: d, sport: Sport.run);
  Map<DateTime, List<ActivitySummary>> map(Map<int, int> counts) => {
        for (final e in counts.entries)
          DateTime.utc(days[e.key].year, days[e.key].month, days[e.key].day): [
            for (var i = 0; i < e.value; i++) summary(days[e.key]),
          ],
      };

  test('collapses consecutive empty past days into one rest block', () {
    final blocks = buildAgenda(days, map({3: 1, 4: 2, 5: 2}), DateTime(2026, 10, 10));
    expect(blocks.first, isA<AgendaRest>());
    expect((blocks.first as AgendaRest).count, 3);
    expect(blocks.whereType<AgendaDay>().map((b) => b.index), [3, 4, 5, 6]);
  });

  test('keeps empty today and future days as their own sections', () {
    final blocks = buildAgenda(days, map({0: 1}), DateTime(2026, 10, 5));
    expect(blocks.whereType<AgendaRest>(), isEmpty);
    expect(blocks.whereType<AgendaDay>().length, 7);
  });

  test('empty days split by a workout produce separate rest blocks', () {
    final blocks = buildAgenda(days, map({2: 1}), DateTime(2026, 10, 11));
    final rests = blocks.whereType<AgendaRest>().toList();
    expect(rests.map((r) => r.count), [2, 3]);
  });
}
