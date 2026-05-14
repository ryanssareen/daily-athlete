// Strava OAuth connect surface for the mobile profile screen.
//
// Flow:
// 1. User taps "Connect Strava" -> state transitions `not_connected ->
//    opening`. We:
//      a. POST /api/integrations/strava/init to obtain a server-signed
//         state nonce (HMAC bound to the authenticated user_id + expiry).
//      b. Hand that state to expo-auth-session as the OAuth state
//         parameter, then call promptAsync().
// 2. expo-auth-session opens the Strava authorize page (deep-link if the
//    Strava app is installed; in-app browser fallback otherwise).
// 3. On callback, expo-auth-session returns { code, state }. We hold the
//    PKCE code_verifier and POST { code, code_verifier, redirect_uri,
//    state } to /api/integrations/strava/connect.
// 4. Branch on HTTP status: 200/202 -> connected; 409 -> account_conflict;
//    4xx -> auth_error; 5xx -> network_error.
//
// Why /init exists:
//   The previous Phase B design accepted both `state` and `expected_state`
//   from the same POST body, which provided no CSRF defense (an attacker
//   controlling the body controls both operands). The /init route mints a
//   server-signed state that only the server can verify; the mobile
//   client cannot forge it. See docs/solutions/strava-oauth.md.
//
// Security notes:
// - PKCE end-to-end. expo-auth-session generates the verifier; we never
//   compute or store it ourselves outside the in-memory request object.
// - State nonce comes from /init; we set it on the AuthRequest BEFORE
//   the authorize hop so Strava echoes it back unchanged.
// - Server validates state HMAC before calling Strava, so an attacker
//   substituting an arbitrary code without the matching state is
//   rejected at our boundary -- before burning the code.
// - postConnect runs ONCE per OAuth result: the previous design had two
//   parallel handlers (a useEffect on the response state and a direct
//   await in onConnect) that could both fire for the same code, burning
//   it on the second call. We now drive the post-OAuth flow exclusively
//   from the direct-await path; the response state from useAuthRequest
//   is informational/test-only.
//
// "Powered by Strava" brand mark. Per Strava brand guidelines, any screen
// that surfaces "Connected to Strava" must show the official mark.
// `BrandMarkText` is a text-only placeholder; replace with the official
// SVG when the brand asset is added to apps/mobile/src/assets/.

import { type StravaConnectRequest } from "@da2/shared";
import * as AuthSession from "expo-auth-session";
import Constants from "expo-constants";
import { useEffect, useReducer, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { supabase } from "@/auth/supabase";
import { colors, spacing, typography } from "@/design/tokens";

import {
  postResponseToAction,
  stravaConnectReducer,
  type StravaConnectState,
} from "./strava-machine";

// Strava OAuth scopes (see plan Phase B KTD):
//   - activity:read_all is required to backfill PRIVATE activities; without
//     it the backfill silently drops them (data-completeness bug).
//   - profile:read_all is needed to read the athlete object whose id we
//     persist as athlete_strava_id.
const STRAVA_SCOPES = [
  "activity:read",
  "activity:read_all",
  "profile:read_all",
];

// Strava OAuth endpoints. The token endpoint is intentionally NOT passed
// to expo-auth-session: we want the code-for-token exchange to happen on
// the server (so the client_secret stays off-device).
const STRAVA_DISCOVERY = {
  authorizationEndpoint: "https://www.strava.com/oauth/authorize",
};

const REDIRECT_PATH = "strava-oauth";

const apiUrl =
  (Constants.expoConfig?.extra?.apiUrl as string) ?? "http://localhost:3000";

const stravaClientId =
  (Constants.expoConfig?.extra?.stravaClientId as string) ??
  process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID ??
  "";

interface ApiCaller {
  (
    path: string,
    init: RequestInit & { body?: string }
  ): Promise<{ status: number; body: unknown }>;
}

/**
 * Real HTTP poster, separated so tests can stub it without mocking the
 * global fetch. Attaches the Supabase access token as a Bearer header so
 * the server can authenticate the call without sharing the SSR cookie
 * jar.
 */
async function defaultPost(
  path: string,
  init: RequestInit & { body?: string }
): Promise<{ status: number; body: unknown }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}

export interface StravaConnectSectionProps {
  /** Test seam: override the HTTP poster for unit tests. */
  apiCaller?: ApiCaller;
  /** Test seam: override the OAuth promptAsync flow. */
  promptAsyncOverride?: () => Promise<
    | { type: "success"; params: { code: string; state?: string } }
    | { type: "cancel" }
    | { type: "error" }
  >;
  /** Test seam: override what the screen reads as code_verifier + state. */
  authRequestOverride?: {
    codeVerifier: string;
    redirectUri: string;
  };
}

/**
 * Profile-screen Strava section. Manages the connect state machine and
 * renders the appropriate copy / control for each state.
 */
export function StravaConnectSection({
  apiCaller = defaultPost,
  promptAsyncOverride,
  authRequestOverride,
}: StravaConnectSectionProps = {}) {
  const [state, dispatch] = useReducer(stravaConnectReducer, {
    kind: "not_connected",
  });
  // Track the last AuthRequest's code_verifier + the signed state we
  // received from /init so the OAuth callback handler can compose the
  // POST body. The verifier comes from expo-auth-session; the state
  // comes from our server.
  const authRequestRef = useRef<{
    codeVerifier: string;
    redirectUri: string;
    signedState: string | null;
  } | null>(null);

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "da2",
    path: REDIRECT_PATH,
  });

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: stravaClientId,
      redirectUri,
      scopes: STRAVA_SCOPES,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      // State is supplied dynamically before promptAsync via
      // request.state = signedState (assigned in onConnect after /init
      // returns). We do NOT let expo-auth-session generate its own state
      // -- the server-signed value is the only state Strava will receive.
    },
    STRAVA_DISCOVERY
  );

  // Mirror the latest request's verifier into the ref. The signed state
  // is set later (in onConnect, after /init). authRequestOverride is a
  // test seam.
  useEffect(() => {
    if (authRequestOverride) {
      authRequestRef.current = {
        codeVerifier: authRequestOverride.codeVerifier,
        redirectUri: authRequestOverride.redirectUri,
        signedState: null,
      };
      return;
    }
    if (request?.codeVerifier) {
      authRequestRef.current = {
        codeVerifier: request.codeVerifier,
        redirectUri,
        signedState: null,
      };
    }
  }, [request, redirectUri, authRequestOverride]);

  async function postConnect(code: string, returnedState?: string) {
    const captured = authRequestRef.current;
    if (!captured) {
      dispatch({ type: "post_4xx", reason: "missing_request_state" });
      return;
    }
    if (!captured.signedState) {
      // Defensive: onConnect should always set this before promptAsync
      // resolves. If it's missing, we have no way to satisfy the server's
      // verifier; surface as auth_error.
      dispatch({ type: "post_4xx", reason: "missing_signed_state" });
      return;
    }
    // Prefer the state Strava echoed back; fall back to what we sent if
    // (for any reason) the callback omitted it. Both should match;
    // server's HMAC verification is the truth.
    const stateToSend = returnedState ?? captured.signedState;
    const body: StravaConnectRequest = {
      code,
      code_verifier: captured.codeVerifier,
      redirect_uri: captured.redirectUri,
      state: stateToSend,
    };
    try {
      const { status, body: respBody } = await apiCaller(
        "/api/integrations/strava/connect",
        { method: "POST", body: JSON.stringify(body) }
      );
      dispatch(postResponseToAction(status, respBody));
    } catch {
      dispatch({ type: "post_5xx" });
    }
  }

  async function fetchSignedState(): Promise<string | null> {
    try {
      const { status, body } = await apiCaller(
        "/api/integrations/strava/init",
        { method: "POST", body: JSON.stringify({}) }
      );
      if (status !== 200) return null;
      if (!body || typeof body !== "object") return null;
      const state = (body as { state?: unknown }).state;
      return typeof state === "string" && state.length > 0 ? state : null;
    } catch {
      return null;
    }
  }

  async function onConnect() {
    if (!stravaClientId) {
      dispatch({ type: "post_4xx", reason: "missing_client_id" });
      return;
    }
    // Idempotent guard: a second tap before the first round trip
    // completes should be a no-op. The Connect button is hidden once
    // state.kind !== 'not_connected' (StravaConnectBody renders the
    // spinner for `opening` and `posting`), but defense in depth:
    if (state.kind !== "not_connected" && state.kind !== "needs_reauth") {
      return;
    }
    dispatch({ type: "tap_connect" });

    // 1. Get a server-signed state from /init BEFORE launching the
    //    authorize page. The state binds to user_id + expiry on the
    //    server side; the client cannot forge it.
    const signedState = await fetchSignedState();
    if (!signedState) {
      dispatch({ type: "post_4xx", reason: "init_failed" });
      return;
    }
    // 2. Plug the signed state into expo-auth-session's AuthRequest so
    //    it's included in the authorize URL Strava sees. We also store
    //    it in the ref for postConnect.
    if (request) {
      request.state = signedState;
    }
    if (authRequestRef.current) {
      authRequestRef.current.signedState = signedState;
    }

    try {
      const prompt = promptAsyncOverride ?? promptAsync;
      const result = await prompt();
      if (result.type === "success" && result.params?.code) {
        dispatch({ type: "oauth_returned_code" });
        await postConnect(result.params.code, result.params.state);
      } else if (result.type === "cancel") {
        dispatch({ type: "oauth_cancelled" });
      } else if (result.type === "error") {
        dispatch({ type: "post_4xx", reason: "oauth_error" });
      } else {
        // Unknown / future result type -- treat as cancel so the user
        // can retry rather than getting stuck in `opening` indefinitely.
        dispatch({ type: "oauth_cancelled" });
      }
    } catch {
      dispatch({ type: "post_5xx" });
    }
  }

  return (
    <View style={styles.section} accessibilityRole="summary">
      <Text style={styles.label}>Strava</Text>
      <StravaConnectBody
        state={state}
        onConnect={onConnect}
        onRetry={() => dispatch({ type: "retry" })}
      />
    </View>
  );
}

interface BodyProps {
  state: StravaConnectState;
  onConnect: () => void;
  onRetry: () => void;
}

function StravaConnectBody({ state, onConnect, onRetry }: BodyProps) {
  switch (state.kind) {
    case "not_connected":
      return (
        <View style={styles.stack}>
          <Text style={styles.body}>
            Connect Strava to pull your last 200 activities and keep your
            calendar in sync.
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={onConnect}
            accessibilityRole="button"
            accessibilityLabel="Connect Strava"
            hitSlop={8}
          >
            <Text style={styles.primaryButtonText}>Connect Strava</Text>
          </Pressable>
        </View>
      );
    case "opening":
      return (
        <View
          style={styles.stack}
          accessibilityLiveRegion="polite"
          accessibilityLabel="Opening Strava"
        >
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.body}>Opening Strava…</Text>
        </View>
      );
    case "posting":
      return (
        <View
          style={styles.stack}
          accessibilityLiveRegion="polite"
          accessibilityLabel="Linking your Strava account"
        >
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.body}>Linking your account…</Text>
        </View>
      );
    case "connected":
      return (
        <View style={styles.stack} accessibilityLiveRegion="polite">
          <Text style={[styles.body, styles.success]}>
            Connected to Strava
          </Text>
          <BrandMarkText />
          <Text style={styles.caption}>
            Backfilling your recent activities — we&apos;ll show progress
            here soon.
          </Text>
        </View>
      );
    case "account_conflict":
      return (
        <View style={styles.stack}>
          <Text style={[styles.body, styles.danger]}>
            This Strava account is already linked to another Daily Athlete
            user. Contact support to resolve.
          </Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            hitSlop={8}
          >
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      );
    case "network_error":
      return (
        <View style={styles.stack}>
          <Text style={[styles.body, styles.danger]}>
            Couldn&apos;t reach Daily Athlete.
          </Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry"
            hitSlop={8}
          >
            <Text style={styles.secondaryButtonText}>Retry</Text>
          </Pressable>
        </View>
      );
    case "auth_error":
      return (
        <View style={styles.stack}>
          <Text style={[styles.body, styles.danger]}>
            Couldn&apos;t connect. Try again.
          </Text>
          <Pressable
            style={styles.secondaryButton}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            hitSlop={8}
          >
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      );
    case "needs_reauth":
      return (
        <View style={styles.stack}>
          <Text style={[styles.body, styles.danger]}>
            Strava connection expired.
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={onConnect}
            accessibilityRole="button"
            accessibilityLabel="Reconnect Strava"
            hitSlop={8}
          >
            <Text style={styles.primaryButtonText}>Reconnect Strava</Text>
          </Pressable>
        </View>
      );
  }
}

// Placeholder for the official Strava brand mark. Strava's API agreement
// requires the "Powered by Strava" mark on any surface that displays
// "Connected to Strava". Swap this for the official SVG asset once the
// brand-assets bundle is added to apps/mobile/src/assets/.
function BrandMarkText() {
  return (
    <Text style={styles.brandMark} accessibilityLabel="Powered by Strava">
      Powered by Strava
    </Text>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  label: { ...typography.caption, color: colors.inkSubtle },
  stack: { gap: spacing.sm },
  body: { ...typography.body, color: colors.ink },
  caption: { ...typography.caption, color: colors.inkSubtle },
  success: { color: colors.success, fontWeight: "600" },
  danger: { color: colors.danger },
  brandMark: { ...typography.caption, color: colors.inkSubtle },
  primaryButton: {
    backgroundColor: colors.brand,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  primaryButtonText: { ...typography.body, color: "#FFFFFF", fontWeight: "600" },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  secondaryButtonText: { ...typography.body, color: colors.ink, fontWeight: "500" },
});
