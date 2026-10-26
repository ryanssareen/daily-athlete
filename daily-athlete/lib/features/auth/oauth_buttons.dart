import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_errors.dart';
import 'auth_notifier.dart';
import 'deep_link_handler.dart';

/// Continue with Google + Apple OAuth buttons, side by side with a divider above.
/// Both flow through Supabase OAuth → da2://auth/callback.
class OAuthButtons extends ConsumerStatefulWidget {
  const OAuthButtons({super.key, this.disabled = false});

  final bool disabled;

  @override
  ConsumerState<OAuthButtons> createState() => _OAuthButtonsState();
}

class _OAuthButtonsState extends ConsumerState<OAuthButtons> {
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // OAuth failures come back through the deep link, not the launch call.
    DeepLinkHandler.callbackError.addListener(_onCallbackError);
  }

  @override
  void dispose() {
    DeepLinkHandler.callbackError.removeListener(_onCallbackError);
    super.dispose();
  }

  void _onCallbackError() {
    final message = DeepLinkHandler.callbackError.value;
    if (message != null && mounted) setState(() => _error = message);
  }

  Future<void> _run(Future<void> Function() action) async {
    DeepLinkHandler.callbackError.value = null;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted && !isAuthCancellation(e)) {
        setState(() => _error = friendlyAuthMessage(e));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final disabled = widget.disabled || _busy;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(child: Divider()),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text(
                'or',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
            const Expanded(child: Divider()),
          ],
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: disabled
              ? null
              : () => _run(
                  ref.read(authNotifierProvider.notifier).signInWithGoogle,
                ),
          icon: const Icon(Icons.g_mobiledata, size: 28),
          label: const Text('Continue with Google'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: disabled
              ? null
              : () => _run(
                  ref.read(authNotifierProvider.notifier).signInWithApple,
                ),
          icon: const Icon(Icons.apple, size: 22),
          label: const Text('Continue with Apple'),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(
            _error!,
            style: TextStyle(color: theme.colorScheme.error, fontSize: 13),
          ),
        ],
      ],
    );
  }
}
