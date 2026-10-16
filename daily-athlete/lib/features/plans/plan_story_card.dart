import 'package:flutter/material.dart';

import '../../models/plan_view.dart';

class PlanStoryCard extends StatelessWidget {
  const PlanStoryCard({super.key, required this.story});

  final PlanStory story;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final quote = story.whyQuote;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final paragraph in story.paragraphs)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(paragraph, style: theme.textTheme.bodyLarge),
          ),
        if (quote != null)
          Container(
            margin: const EdgeInsets.only(top: 4),
            padding: const EdgeInsets.only(left: 12),
            decoration: BoxDecoration(
              border: Border(left: BorderSide(color: theme.colorScheme.primary, width: 3)),
            ),
            child: Text(
              '“$quote”',
              style: theme.textTheme.bodyMedium?.copyWith(
                fontStyle: FontStyle.italic,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
      ],
    );
  }
}
