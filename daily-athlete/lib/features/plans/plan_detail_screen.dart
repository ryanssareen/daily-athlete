// Plan detail screen (mobile mirror of
// apps/web/app/(athlete)/plans/[id]/page.tsx) — a single plan's status,
// event, and source, reached from plan_history_screen.dart.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../models/plan.dart';
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

class _PlanDetailBody extends StatelessWidget {
  const _PlanDetailBody({required this.plan});

  final PlanRow plan;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                plan.eventType?.isNotEmpty == true ? plan.eventType! : 'Training plan',
                style: theme.textTheme.headlineSmall,
              ),
            ),
            _StatusChip(status: plan.status),
          ],
        ),
        const SizedBox(height: 20),
        _DetailRow(
          label: 'Event date',
          value: plan.eventDate == null ? '—' : DateFormat.yMMMMd().format(plan.eventDate!),
        ),
        _DetailRow(
          label: 'Created',
          value: plan.createdAt == null ? '—' : DateFormat.yMMMMd().add_jm().format(plan.createdAt!),
        ),
        _DetailRow(label: 'Source', value: _sourceLabel(plan.source)),
        if (plan.archivedAt != null)
          _DetailRow(
            label: 'Archived',
            value: DateFormat.yMMMMd().add_jm().format(plan.archivedAt!),
          ),
      ],
    );
  }

  String _sourceLabel(PlanSource source) {
    switch (source) {
      case PlanSource.aiGenerated:
        return 'AI generated';
      case PlanSource.coachAssigned:
        return 'Assigned by coach';
      case PlanSource.imported:
        return 'Imported';
    }
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

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          SizedBox(
            width: 110,
            child: Text(label, style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
          ),
          Expanded(child: Text(value, style: theme.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}
