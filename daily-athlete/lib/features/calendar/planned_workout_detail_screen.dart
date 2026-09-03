// Planned-workout detail screen (mobile mirror of
// apps/web/app/(athlete)/athlete/planned/[id]/page.tsx). Renders the
// view-model built by planned_workout_detail_view.dart from the row fetched
// by planned_workout_detail_provider.dart.
//
// Four states, per the corrected U3 scope: loading (spinner), error
// (message + retry), data: null (soft-deleted / foreign / missing row —
// "Workout not found" with a way back), data: <row> (the view-model's
// output). All AI-generated/free-text values (rationale, description, step
// labels) render via plain Text(...) only — never any HTML-rendering widget
// (R7).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/planned_workout.dart';
import '../../router/routes.dart';
import 'planned_workout_detail_provider.dart';
import 'planned_workout_detail_view.dart';

class PlannedWorkoutDetailScreen extends ConsumerWidget {
  const PlannedWorkoutDetailScreen({super.key, required this.workoutId});

  final String workoutId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workoutAsync = ref.watch(plannedWorkoutDetailProvider(workoutId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Planned Workout'),
        leading: BackButton(onPressed: () => _navigateBack(context)),
      ),
      body: workoutAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => _ErrorView(
          error: err.toString(),
          onRetry: () => ref.invalidate(plannedWorkoutDetailProvider(workoutId)),
        ),
        data: (row) {
          if (row == null) {
            return _NotFoundView(onBack: () => _navigateBack(context));
          }
          return _DetailBody(view: buildPlannedWorkoutView(row), row: row);
        },
      ),
    );
  }

  void _navigateBack(BuildContext context) {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(Routes.calendar);
    }
  }
}

// ---------------------------------------------------------------------------
// Data state
// ---------------------------------------------------------------------------

class _DetailBody extends StatelessWidget {
  const _DetailBody({required this.view, required this.row});

  final PlannedWorkoutView view;
  final PlannedWorkoutRow row;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final steps = view.steps;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Text(row.sport.displayName, style: theme.textTheme.headlineSmall),
        const SizedBox(height: 4),
        Text(
          _formatDate(row.scheduledDate),
          style: theme.textTheme.bodySmall
              ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 20),
        _StatRow(
          durationDisplay: view.durationDisplay,
          loadDisplay: view.loadDisplay,
          intensityDisplay: view.intensityDisplay,
        ),
        if (view.description != null) ...[
          const SizedBox(height: 16),
          _Section(title: 'Description', child: Text(view.description!)),
        ],
        if (view.rationale != null) ...[
          const SizedBox(height: 16),
          _Section(title: 'Rationale', child: Text(view.rationale!)),
        ],
        if (steps != null && steps.isNotEmpty) ...[
          const SizedBox(height: 16),
          _Section(
            title: 'Steps',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: steps.map((s) => _StepRow(step: s)).toList(),
            ),
          ),
        ],
      ],
    );
  }

  static String _formatDate(DateTime date) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[date.month - 1]} ${date.day}, ${date.year}';
  }
}

class _StatRow extends StatelessWidget {
  const _StatRow({
    required this.durationDisplay,
    required this.loadDisplay,
    required this.intensityDisplay,
  });

  final String durationDisplay;
  final String loadDisplay;
  final String intensityDisplay;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final items = <(String, String)>[
      ('Duration', durationDisplay),
      ('Load', loadDisplay),
      ('Intensity', intensityDisplay),
    ];
    return Row(
      children: items
          .map(
            (item) => Expanded(
              child: Column(
                children: [
                  Text(item.$2, style: theme.textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(
                    item.$1,
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          )
          .toList(),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title.toUpperCase(),
              style: theme.textTheme.labelSmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant, letterSpacing: 1),
            ),
            const SizedBox(height: 10),
            child,
          ],
        ),
      ),
    );
  }
}

class _StepRow extends StatelessWidget {
  const _StepRow({required this.step});
  final PlannedStepView step;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(step.label ?? 'Step', style: theme.textTheme.bodyMedium),
          ),
          Text(step.durationDisplay, style: theme.textTheme.bodySmall),
          if (step.intensityDisplay != null) ...[
            const SizedBox(width: 8),
            Text(
              step.intensityDisplay!,
              style: theme.textTheme.bodySmall
                  ?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.error, required this.onRetry});
  final String error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.cloud_off_outlined, size: 48, color: theme.colorScheme.error),
          const SizedBox(height: 16),
          Text('Could not load this workout', style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(
            error,
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          FilledButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Retry')),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Not-found state (soft-deleted, missing, or belongs to another athlete)
// ---------------------------------------------------------------------------

class _NotFoundView extends StatelessWidget {
  const _NotFoundView({required this.onBack});
  final VoidCallback onBack;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.event_busy_outlined, size: 48, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(height: 16),
          Text('Workout not found', style: theme.textTheme.titleMedium, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(
            'This planned workout may have been removed or is no longer available.',
            style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          FilledButton(onPressed: onBack, child: const Text('Back to calendar')),
        ],
      ),
    );
  }
}
