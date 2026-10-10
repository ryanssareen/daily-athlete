import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../router/routes.dart';
import 'eyebrow.dart';

/// In-body screen title that replaces the AppBar title on tab screens.
class ScreenHeader extends StatelessWidget {
  const ScreenHeader({
    super.key,
    required this.title,
    this.eyebrow,
    this.trailing,
    this.bottom,
  });

  final String title;
  final String? eyebrow;
  final Widget? trailing;
  final Widget? bottom;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (eyebrow != null) ...[
            Eyebrow(eyebrow!),
            const SizedBox(height: 4),
          ],
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 12), trailing!],
            ],
          ),
          if (bottom != null) ...[const SizedBox(height: 8), bottom!],
        ],
      ),
    );
  }
}

/// Opens Settings, which is no longer a tab.
class SettingsAvatarButton extends StatelessWidget {
  const SettingsAvatarButton({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      button: true,
      label: 'Settings',
      child: InkResponse(
        radius: 24,
        onTap: () => context.push(Routes.settings),
        child: CircleAvatar(
          radius: 18,
          backgroundColor: scheme.secondaryContainer,
          child: Icon(
            Icons.person_outline,
            size: 20,
            color: scheme.onSecondaryContainer,
          ),
        ),
      ),
    );
  }
}

String eyebrowDate(DateTime d) {
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  return '${days[d.weekday - 1]} · ${d.day} ${months[d.month - 1]}';
}
