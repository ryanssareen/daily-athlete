import 'package:flutter/material.dart';

import '../../models/plan_view.dart';
import 'plan_view_format.dart';

class PlanForecastCard extends StatelessWidget {
  const PlanForecastCard({super.key, required PlanForecast this.forecast}) : onRetry = null;

  const PlanForecastCard.failed({super.key, required VoidCallback this.onRetry}) : forecast = null;

  final PlanForecast? forecast;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: switch (forecast) {
          ForecastOk ok => _ForecastFigures(forecast: ok),
          ForecastUnavailableNoData() => const _Message('Not enough planned load to forecast'),
          ForecastUnavailableComplete() => const _Message('This block is finished'),
          null => _FailedMessage(onRetry: onRetry!),
        },
      ),
    );
  }
}

class _Message extends StatelessWidget {
  const _Message(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Text(text, style: Theme.of(context).textTheme.bodyMedium);
}

class _FailedMessage extends StatelessWidget {
  const _FailedMessage({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Expanded(child: Text("Couldn't load the forecast")),
        TextButton(
          style: TextButton.styleFrom(minimumSize: const Size(44, 44)),
          onPressed: onRetry,
          child: const Text('Retry'),
        ),
      ],
    );
  }
}

class _ForecastFigures extends StatelessWidget {
  const _ForecastFigures({required this.forecast});

  final ForecastOk forecast;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final eventDay = forecast.eventDay;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(endOfBlockLabel(forecast.endOfBlockDate), style: theme.textTheme.labelMedium?.copyWith(color: muted)),
        const SizedBox(height: 4),
        Text(forecast.formVerdict, style: theme.textTheme.titleMedium),
        const SizedBox(height: 12),
        _Figure(
          label: 'Fitness (CTL)',
          value: forecast.ctl.round().toString(),
          meaning: 'Your training base, built up over weeks',
        ),
        _Figure(
          label: 'Fatigue (ATL)',
          value: forecast.atl.round().toString(),
          meaning: 'How much recent training is weighing on you',
        ),
        _Figure(
          label: 'Form (TSB)',
          value: formatSigned(forecast.tsb),
          meaning: 'Fitness minus fatigue; higher means fresher',
        ),
        if (eventDay != null) ...[
          const Divider(height: 24),
          Text(eventDayLabel(eventDay.date), style: theme.textTheme.labelMedium?.copyWith(color: muted)),
          const SizedBox(height: 4),
          Text('${eventDay.formVerdict} (form ${formatSigned(eventDay.tsb)})', style: theme.textTheme.bodyMedium),
        ],
      ],
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.label, required this.value, required this.meaning});

  final String label;
  final String value;
  final String meaning;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: theme.textTheme.labelLarge),
                Text(meaning, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Text(value, style: theme.textTheme.titleMedium),
        ],
      ),
    );
  }
}
