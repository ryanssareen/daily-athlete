// lib/features/calendar/workout_action_sheet.dart
//
// Bottom sheet presented on long-press / tap of a planned workout chip.
// Three actions: Complete, Skip, Reschedule.
// Calls POST /api/workouts/[id]/status with the new status.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/env.dart';
import '../../models/planned_workout.dart';
import '../../router/routes.dart';

class WorkoutActionSheet extends StatefulWidget {
  const WorkoutActionSheet({super.key, required this.workout});

  final PlannedWorkoutRow workout;

  @override
  State<WorkoutActionSheet> createState() =>
      _WorkoutActionSheetState();
}

class _WorkoutActionSheetState extends State<WorkoutActionSheet> {
  bool _loading = false;
  String? _error;

  Future<void> _updateStatus(String status,
      {DateTime? rescheduledDate}) async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final session = Supabase.instance.client.auth.currentSession;
      if (session == null) throw Exception('Not authenticated');

      final body = <String, dynamic>{'status': status};
      if (rescheduledDate != null) {
        body['scheduled_date'] =
            rescheduledDate.toIso8601String().substring(0, 10);
      }

      final uri = Uri.parse(
          '${Env.apiBaseUrl}/api/workouts/${widget.workout.id}/status');
      final response = await http.post(
        uri,
        headers: {
          'Authorization': 'Bearer ${session.accessToken}',
          'Content-Type': 'application/json',
        },
        body: jsonEncode(body),
      );

      if (response.statusCode == 200) {
        if (mounted) Navigator.of(context).pop();
      } else {
        final msg = _parseErrorMessage(response.body);
        setState(() => _error = msg);
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _parseErrorMessage(String body) {
    try {
      final json = jsonDecode(body) as Map<String, dynamic>;
      return json['error'] as String? ?? 'Unknown error';
    } catch (_) {
      return 'Request failed';
    }
  }

  Future<void> _handleReschedule() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: widget.workout.scheduledDate
          .add(const Duration(days: 1)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (picked == null || !mounted) return;
    await _updateStatus('moved', rescheduledDate: picked);
  }

  void _handleViewDetails() {
    final route =
        Routes.plannedWorkoutDetail.replaceFirst(':id', widget.workout.id);
    Navigator.of(context).pop();
    context.go(route);
  }

  @override
  Widget build(BuildContext context) {
    final pw = widget.workout;
    final theme = Theme.of(context);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Drag handle
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

            // Workout title
            Text(
              pw.rationale ?? pw.sport.displayName,
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w600),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 4),
            Text(
              pw.sport.displayName,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              ),
              textAlign: TextAlign.center,
            ),

            const SizedBox(height: 20),

            if (_error != null) ...[
              Text(
                _error!,
                style: theme.textTheme.bodySmall
                    ?.copyWith(color: theme.colorScheme.error),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
            ],

            if (_loading)
              const Center(child: CircularProgressIndicator())
            else ...[
              // Complete
              FilledButton.icon(
                icon: const Icon(Icons.check_circle_outline),
                label: const Text('Mark Complete'),
                onPressed: () => _updateStatus('completed'),
              ),
              const SizedBox(height: 8),

              // Skip
              OutlinedButton.icon(
                icon: const Icon(Icons.do_not_disturb_on_outlined),
                label: const Text('Skip'),
                onPressed: () => _updateStatus('skipped'),
              ),
              const SizedBox(height: 8),

              // Reschedule
              OutlinedButton.icon(
                icon: const Icon(Icons.calendar_today_outlined),
                label: const Text('Reschedule'),
                onPressed: _handleReschedule,
              ),
              const SizedBox(height: 8),

              // View details
              TextButton.icon(
                icon: const Icon(Icons.info_outline),
                label: const Text('View details'),
                onPressed: _handleViewDetails,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
