import 'package:flutter/material.dart';

import '../../core/layout.dart';

/// Shell for a tab with a master list and a detail route.
///
/// On expanded widths the [master] stays mounted beside the routed [detail]
/// (so its scroll position survives selection changes); everywhere else the
/// routed child is shown alone, exactly as on phones.
class ListDetailSplit extends StatelessWidget {
  const ListDetailSplit({
    super.key,
    required this.master,
    required this.detail,
    this.masterWidth,
    this.detailWidth,
    this.showDetail = true,
  }) : assert((masterWidth == null) != (detailWidth == null)),
       assert(showDetail || detailWidth != null);

  final Widget master;
  final Widget detail;

  /// Fixed width of the master pane (detail fills the rest).
  final double? masterWidth;

  /// Fixed width of the detail pane (master fills the rest).
  final double? detailWidth;

  /// When false (fixed-width detail only), the detail pane collapses to zero
  /// width so the master gets the whole screen until something is selected.
  final bool showDetail;

  @override
  Widget build(BuildContext context) {
    if (context.layout != LayoutSize.expanded) return detail;

    // Child count and order stay constant so the master keeps its state when
    // the detail pane opens or closes.
    return Row(
      children: [
        masterWidth != null
            ? SizedBox(width: masterWidth, child: master)
            : Expanded(child: master),
        VerticalDivider(
          width: showDetail ? 1 : 0,
          thickness: showDetail ? 1 : 0,
          color: Theme.of(context).colorScheme.outlineVariant,
        ),
        detailWidth != null
            ? SizedBox(
                width: showDetail ? detailWidth : 0,
                child: ClipRect(child: detail),
              )
            : Expanded(child: detail),
      ],
    );
  }
}

/// Detail-pane placeholder shown when nothing is selected.
class DetailPlaceholder extends StatelessWidget {
  const DetailPlaceholder({
    super.key,
    required this.icon,
    required this.message,
  });

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ColoredBox(
      color: scheme.surface,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 40, color: scheme.onSurfaceVariant),
              const SizedBox(height: 12),
              Text(
                message,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
