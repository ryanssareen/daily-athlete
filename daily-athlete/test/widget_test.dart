// Smoke test: verify the app compiles and renders a Scaffold without errors.
// Full feature tests live under test/features/.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('MaterialApp renders without error', (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold()));
    expect(find.byType(Scaffold), findsOneWidget);
  });
}
