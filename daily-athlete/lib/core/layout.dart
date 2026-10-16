import 'package:flutter/widgets.dart';

/// Window-size classes. Chosen from the current window width, not the device
/// model, so iPad split view, Slide Over and rotation resolve correctly.
enum LayoutSize { compact, medium, expanded }

extension LayoutContext on BuildContext {
  LayoutSize get layout {
    final width = MediaQuery.sizeOf(this).width;
    if (width >= 1024) return LayoutSize.expanded;
    if (width >= 600) return LayoutSize.medium;
    return LayoutSize.compact;
  }

  bool get isTabletDevice => MediaQuery.sizeOf(this).shortestSide >= 600;
}
