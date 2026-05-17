import 'package:daily_athlete/models/sport.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Sport', () {
    test('fromString returns correct enum for known values', () {
      expect(Sport.fromString('run'), Sport.run);
      expect(Sport.fromString('swim'), Sport.swim);
      expect(Sport.fromString('bike'), Sport.bike);
      expect(Sport.fromString('strength'), Sport.strength);
      expect(Sport.fromString('mobility'), Sport.mobility);
      expect(Sport.fromString('other'), Sport.other);
    });

    test('fromString returns Sport.other for unknown value', () {
      expect(Sport.fromString('unicycle'), Sport.other);
      expect(Sport.fromString(''), Sport.other);
    });

    test('name produces the DB-expected lowercase string', () {
      expect(Sport.run.name, 'run');
      expect(Sport.bike.name, 'bike');
    });
  });
}
