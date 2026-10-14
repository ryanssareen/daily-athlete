// Plan detail screen (mobile mirror of
// apps/web/app/(athlete)/plans/[id]/page.tsx) — a single plan's status,
// event, and source, reached from plan_history_screen.dart.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../models/plan.dart';
import 'plan_overview.dart';
import 'plans_providers.dart';

class PlanDetailScreen extends ConsumerWidget {
  const PlanDetailScreen({super.key, required this.planId});

  final String planId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final planAsync = ref.watch(planDetailProvider(planId));

    return Scaffold(
      appBar: AppBar(title: const Text('Plan')),
      body: planAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(
              'Could not load this plan.',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
          ),
        ),
        data: (plan) => _PlanDetailBody(plan: plan),
      ),
    );
  }
}

class _PlanDetailBody extends ConsumerWidget {
  const _PlanDetailBody({required this.plan});

  final PlanRow plan;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final workoutsAsync = ref.watch(planWorkoutsProvider(plan.id));
    final title = plan.eventType?.isNotEmpty == true ? plan.eventType! : 'Training plan';
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(child: Text(title, style: theme.textTheme.titleMedium)),
            _StatusChip(status: plan.status),
          ],
        ),
        const SizedBox(height: 16),
        workoutsAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(24),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (_, _) => Text(
            "Could not load this plan's workouts.",
            style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
          ),
          data: (workouts) => PlanOverview(plan: plan, workouts: workouts),
        ),
        const SizedBox(height: 24),
        Text(
          _footnote(plan),
          style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
        ),
      ],
    );
  }

  String _footnote(PlanRow plan) {
    final parts = <String>[
      if (plan.createdAt != null) 'Created ${DateFormat.yMMMd().format(plan.createdAt!)}',
      if (plan.archivedAt != null) 'archived ${DateFormat.yMMMd().format(plan.archivedAt!)}',
      if (plan.source == PlanSource.coachAssigned) 'assigned by your coach',
    ];
    return parts.join(' · ');
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final PlanStatus status;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isActive = status == PlanStatus.active;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
      decoration: BoxDecoration(
        color: isActive
            ? theme.colorScheme.primaryContainer
            : theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        isActive ? 'ACTIVE' : 'ARCHIVED',
        style: theme.textTheme.labelSmall?.copyWith(
          color: isActive ? theme.colorScheme.onPrimaryContainer : theme.colorScheme.onSurfaceVariant,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}
