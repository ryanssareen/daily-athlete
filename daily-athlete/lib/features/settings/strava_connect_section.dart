// StravaConnectSection — Strava connect/disconnect widget for the Settings tab.
//
// Shows connection state and handles the full OAuth flow via StravaOAuthService.
// Strava brand guidelines require the "Powered by Strava" mark on any surface
// that shows "Connected to Strava". The BrandMarkText widget below is a
// text-only placeholder; replace with the official SVG when the asset is added.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'settings_providers.dart';

class StravaConnectSection extends ConsumerWidget {
  const StravaConnectSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final oauthAsync = ref.watch(stravaOAuthServiceProvider);

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Strava',
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: Colors.grey.shade600),
            ),
            const SizedBox(height: 12),
            oauthAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator.adaptive()),
              error: (_, _) => _StravaErrorBody(
                message: 'Could not load Strava status.',
                onRetry: () =>
                    ref.invalidate(stravaOAuthServiceProvider),
              ),
              data: (oauthState) => _StravaBody(oauthState: oauthState),
            ),
          ],
        ),
      ),
    );
  }
}

class _StravaBody extends ConsumerWidget {
  const _StravaBody({required this.oauthState});
  final StravaOAuthState oauthState;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    switch (oauthState.status) {
      case StravaConnectionStatus.notConnected:
        return _NotConnectedBody(
          onConnect: () =>
              ref.read(stravaOAuthServiceProvider.notifier).connect(),
        );

      case StravaConnectionStatus.opening:
        return const _LoadingBody(label: 'Opening Strava…');

      case StravaConnectionStatus.posting:
        return const _LoadingBody(label: 'Linking your account…');

      case StravaConnectionStatus.connected:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Connected to Strava',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: Colors.green.shade700, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            const Text(
              'Powered by Strava',
              style: TextStyle(fontSize: 11, color: Colors.grey),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () =>
                  ref.read(stravaOAuthServiceProvider.notifier).reset(),
              child: const Text('Disconnect Strava'),
            ),
          ],
        );

      case StravaConnectionStatus.accountConflict:
        return _StravaErrorBody(
          message: oauthState.errorMessage ??
              'This Strava account is already linked to another user.',
          onRetry: () => ref.read(stravaOAuthServiceProvider.notifier).reset(),
        );

      case StravaConnectionStatus.authError:
      case StravaConnectionStatus.networkError:
        return _StravaErrorBody(
          message: oauthState.errorMessage ?? 'Could not connect Strava.',
          onRetry: () => ref.read(stravaOAuthServiceProvider.notifier).reset(),
        );
    }
  }
}

class _NotConnectedBody extends StatelessWidget {
  const _NotConnectedBody({required this.onConnect});
  final VoidCallback onConnect;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Connect Strava to pull your last 200 activities and keep your calendar in sync.',
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: onConnect,
          child: const Text('Connect Strava'),
        ),
      ],
    );
  }
}

class _LoadingBody extends StatelessWidget {
  const _LoadingBody({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const SizedBox(
          width: 18,
          height: 18,
          child: CircularProgressIndicator.adaptive(strokeWidth: 2),
        ),
        const SizedBox(width: 12),
        Text(label),
      ],
    );
  }
}

class _StravaErrorBody extends StatelessWidget {
  const _StravaErrorBody({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          message,
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
        const SizedBox(height: 12),
        OutlinedButton(
          onPressed: onRetry,
          child: const Text('Try again'),
        ),
      ],
    );
  }
}
