import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../../core/env.dart';
import '../../models/sport.dart';
import '../auth/auth_notifier.dart';
import '../activities/activities_providers.dart';

/// Bottom sheet for manually logging an activity (R8).
///
/// Fields:
///   - Sport picker (dropdown)
///   - Date (date picker)
///   - Duration hh:mm (two integer fields)
///   - Distance (optional, metres converted from km input)
///   - Notes (optional)
///
/// On submit: POST /api/activities/manual with Bearer token.
/// On success: invalidates activityFeedProvider and closes.
class ManualLogSheet extends ConsumerStatefulWidget {
  const ManualLogSheet({super.key});

  @override
  ConsumerState<ManualLogSheet> createState() => _ManualLogSheetState();
}

class _ManualLogSheetState extends ConsumerState<ManualLogSheet> {
  final _formKey = GlobalKey<FormState>();

  Sport _sport = Sport.run;
  DateTime _date = DateTime.now();
  final _hoursController = TextEditingController(text: '0');
  final _minutesController = TextEditingController(text: '30');
  final _distanceController = TextEditingController();
  final _notesController = TextEditingController();

  bool _submitting = false;
  String? _errorMessage;

  @override
  void dispose() {
    _hoursController.dispose();
    _minutesController.dispose();
    _distanceController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  int get _durationSeconds {
    final h = int.tryParse(_hoursController.text) ?? 0;
    final m = int.tryParse(_minutesController.text) ?? 0;
    return h * 3600 + m * 60;
  }

  double? get _distanceM {
    final km = double.tryParse(_distanceController.text);
    if (km == null || km <= 0) return null;
    return km * 1000;
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2000),
      lastDate: DateTime.now(),
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final authAsync = await ref.read(authNotifierProvider.future);
    final token = authAsync.accessToken;
    if (token == null) {
      setState(() => _errorMessage = 'Not authenticated');
      return;
    }

    setState(() {
      _submitting = true;
      _errorMessage = null;
    });

    try {
      final body = <String, dynamic>{
        'sport': _sport.name,
        'started_at': _date.toUtc().toIso8601String(),
        'duration_s': _durationSeconds,
        if (_distanceM != null) 'distance_m': _distanceM,
        if (_notesController.text.trim().isNotEmpty)
          'notes': _notesController.text.trim(),
      };

      final response = await http.post(
        Uri.parse('${Env.apiBaseUrl}/api/activities/manual'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(body),
      );

      if (!mounted) return;

      if (response.statusCode == 201) {
        // Invalidate the feed so it reloads with the new activity.
        ref.invalidate(activityFeedProvider);
        Navigator.of(context).pop();
      } else {
        setState(() {
          _errorMessage = 'Failed to log activity (${response.statusCode})';
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _errorMessage = 'Network error: $e');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Form(
        key: _formKey,
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
                  color: theme.colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),

            Text(
              'Log Activity',
              style: theme.textTheme.titleLarge,
            ),
            const SizedBox(height: 20),

            // Sport picker
            DropdownButtonFormField<Sport>(
              value: _sport,
              decoration: const InputDecoration(
                labelText: 'Sport',
                border: OutlineInputBorder(),
              ),
              items: Sport.values
                  .map(
                    (s) => DropdownMenuItem(
                      value: s,
                      child: Text(s.displayName),
                    ),
                  )
                  .toList(),
              onChanged: (s) {
                if (s != null) setState(() => _sport = s);
              },
            ),
            const SizedBox(height: 16),

            // Date picker
            InkWell(
              onTap: _pickDate,
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Date',
                  border: OutlineInputBorder(),
                  suffixIcon: Icon(Icons.calendar_today),
                ),
                child: Text(_formatDate(_date)),
              ),
            ),
            const SizedBox(height: 16),

            // Duration row (hh:mm)
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _hoursController,
                    decoration: const InputDecoration(
                      labelText: 'Hours',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    validator: (v) {
                      final h = int.tryParse(v ?? '');
                      if (h == null || h < 0) return 'Invalid';
                      return null;
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _minutesController,
                    decoration: const InputDecoration(
                      labelText: 'Minutes',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    validator: (v) {
                      final m = int.tryParse(v ?? '');
                      if (m == null || m < 0 || m > 59) return '0–59';
                      // Cross-field: total must be > 0
                      final h = int.tryParse(_hoursController.text) ?? 0;
                      if (h == 0 && m == 0) return 'Must be > 0';
                      return null;
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // Distance (optional)
            TextFormField(
              controller: _distanceController,
              decoration: const InputDecoration(
                labelText: 'Distance (km) — optional',
                border: OutlineInputBorder(),
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              validator: (v) {
                if (v == null || v.isEmpty) return null;
                final d = double.tryParse(v);
                if (d == null || d < 0) return 'Enter a valid distance';
                return null;
              },
            ),
            const SizedBox(height: 16),

            // Notes (optional)
            TextFormField(
              controller: _notesController,
              decoration: const InputDecoration(
                labelText: 'Notes — optional',
                border: OutlineInputBorder(),
              ),
              maxLines: 2,
            ),
            const SizedBox(height: 8),

            if (_errorMessage != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _errorMessage!,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),

            FilledButton(
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Log Activity'),
            ),
          ],
        ),
      ),
    );
  }

  static String _formatDate(DateTime dt) {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return '${months[dt.month - 1]} ${dt.day}, ${dt.year}';
  }
}

/// Shows [ManualLogSheet] as a modal bottom sheet.
Future<void> showManualLogSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (_) => const ManualLogSheet(),
  );
}
