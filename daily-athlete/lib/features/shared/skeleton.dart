import 'package:flutter/material.dart';

/// Pulsing placeholder shown while content loads. Wrap a tree of [SkeletonBox]
/// in a [Skeleton] so all boxes share one animation.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, required this.child});

  final Widget child;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  );

  @override
  void initState() {
    super.initState();
    _controller.repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Loading',
      child: ExcludeSemantics(
        child: FadeTransition(
          opacity: Tween<double>(begin: 0.45, end: 1).animate(
            CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
          ),
          child: widget.child,
        ),
      ),
    );
  }
}

/// A rounded rectangle placeholder.
class SkeletonBox extends StatelessWidget {
  const SkeletonBox({super.key, this.width, this.height = 14, this.radius = 8});

  final double? width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

/// Placeholder shaped like an activity feed row.
class SkeletonListRow extends StatelessWidget {
  const SkeletonListRow({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          SkeletonBox(width: 40, height: 40, radius: 12),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SkeletonBox(width: 160, height: 14),
                SizedBox(height: 8),
                SkeletonBox(width: 100, height: 12),
              ],
            ),
          ),
          SkeletonBox(width: 48, height: 14),
        ],
      ),
    );
  }
}

/// Activities tab loading state.
class ActivityFeedSkeleton extends StatelessWidget {
  const ActivityFeedSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        children: [for (var i = 0; i < 8; i++) const SkeletonListRow()],
      ),
    );
  }
}

/// Home loading state: hero card, plan card, recent rows.
class DashboardSkeleton extends StatelessWidget {
  const DashboardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
        children: const [
          SkeletonBox(height: 160, radius: 20),
          SizedBox(height: 24),
          SkeletonBox(height: 110, radius: 20),
          SizedBox(height: 24),
          SkeletonBox(width: 120, height: 14),
          SizedBox(height: 8),
          SkeletonListRow(),
          SkeletonListRow(),
          SkeletonListRow(),
        ],
      ),
    );
  }
}

/// Calendar agenda (week/day) loading state.
class CalendarAgendaSkeleton extends StatelessWidget {
  const CalendarAgendaSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        children: const [
          SkeletonBox(height: 96, radius: 16),
          SizedBox(height: 20),
          SkeletonBox(width: 90, height: 12),
          SizedBox(height: 8),
          SkeletonBox(height: 64, radius: 14),
          SizedBox(height: 20),
          SkeletonBox(width: 90, height: 12),
          SizedBox(height: 8),
          SkeletonBox(height: 64, radius: 14),
          SizedBox(height: 8),
          SkeletonBox(height: 64, radius: 14),
        ],
      ),
    );
  }
}

/// Calendar month grid loading state.
class CalendarMonthSkeleton extends StatelessWidget {
  const CalendarMonthSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return Skeleton(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            const SkeletonBox(width: 140, height: 18),
            const SizedBox(height: 20),
            for (var r = 0; r < 5; r++) ...[
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  for (var c = 0; c < 7; c++)
                    const SkeletonBox(width: 36, height: 36, radius: 18),
                ],
              ),
              const SizedBox(height: 16),
            ],
          ],
        ),
      ),
    );
  }
}
