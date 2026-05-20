// lib/features/calendar/assign_workout_sheet.dart
//
// Coach: bottom sheet for assigning a workout to a selected athlete.
// Submits to POST /api/coach/workouts (Unit 10).
// Requires an athlete to be selected via calendarAthleteIdProvider.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';
import '../../models/sport.dart';
import 'calendar_providers.dart';

class AssignWorkoutSheet extends ConsumerStatefulWidget {
  const AssignWorkoutSheet({super.key, required this.date});

  final DateTime date;

  @override
  ConsumerState<AssignWorkoutSheet> createState() =>
      _AssignWorkoutSheetState();
}

class _AssignWorkoutSheetState extends ConsumerState<AssignWorkoutSheet> {
  // Start empty — the coach picks the sport and enters the duration. No
  // prefilled defaults (issue #82).
  Sport? _sport;
  final _durationController = TextEditingController();
  final _notesController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _durationController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    // Single-flight guard: ignore taps while a submit is already in flight so
    // Create does exactly one upload (issue #81).
    if (_loading) return;

    final athleteId = ref.read(calendarAthleteIdProvider);
    if (athleteId == null) {
      setState(() => _error = 'Please select an athlete first.');
      return;
    }

    final sport = _sport;
    if (sport == null) {
      setState(() => _error = 'Please choose a sport.');
      return;
    }

    final durationMinutes = int.tryParse(_durationController.text.trim());
    if (durationMinutes == null || durationMinutes <= 0) {
      setState(() => _error = 'Please enter a duration in minutes.');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) throw Exception('Not authenticated');

      final body = {
        'athlete_id': athleteId,
        'scheduled_date':
            widget.date.toIso8601String().substring(0, 10),
        'sport': sport.name,
        'structure': {
          'duration_s': durationMinutes * 60,
        },
        if (_notesController.text.trim().isNotEmpty)
          'rationale': _notesController.text.trim(),
      };

      final uri =
          Uri.parse('${Env.apiBaseUrl}/api/coach/workouts');
      final response = await http.post(
        uri,
        headers: {
          'Authorization': 'Bearer ${session.accessToken}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode(body),
      );

      if (!mounted) return;

      if (response.statusCode == 201 || response.statusCode == 200) {
        Navigator.of(context).pop();
      } else {
        final msg = _parseError(response.body);
        setState(() => _error = msg);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _parseError(String body) {
    try {
      final json = jsonDecode(body) as Map<String, dynamic>;
      return json['error'] as String? ?? 'Unknown error';
    } catch (_) {
      return 'Request failed';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dateLabel = DateFormat.yMMMd().format(widget.date);

    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        12,
        16,
        MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Handle
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: theme.dividerColor,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          Text(
            'Assign Workout — $dateLabel',
            style: theme.textTheme.titleMedium
                ?.copyWith(fontWeight: FontWeight.w600),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 20),

          // Sport picker — starts empty (no default selection).
          DropdownButtonFormField<Sport>(
            initialValue: _sport,
            decoration: const InputDecoration(
              labelText: 'Sport',
              border: OutlineInputBorder(),
            ),
            hint: const Text('Select a sport'),
            items: Sport.values
                .map((s) => DropdownMenuItem(
                      value: s,
                      child: Text(s.displayName),
                    ))
                .toList(),
            onChanged: (s) {
              if (s != null) setState(() => _sport = s);
            },
          ),
          const SizedBox(height: 12),

          // Duration — starts empty.
          TextField(
            controller: _durationController,
            decoration: const InputDecoration(
              labelText: 'Duration (minutes)',
              border: OutlineInputBorder(),
            ),
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          ),
          const SizedBox(height: 12),

          // Notes
          TextField(
            controller: _notesController,
            decoration: const InputDecoration(
              labelText: 'Notes / Rationale (optional)',
              border: OutlineInputBorder(),
            ),
            maxLines: 2,
          ),
          const SizedBox(height: 16),

          if (_error != null) ...[
            Text(
              _error!,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.error),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
          ],

          // Disabled while a submit is in flight so Create can only fire once.
          FilledButton(
            onPressed: _loading ? null : _submit,
            child: _loading
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Assign Workout'),
          ),
        ],
      ),
    );
  }
}
