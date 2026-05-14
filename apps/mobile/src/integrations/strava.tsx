// Strava OAuth connect surface for the mobile profile screen.
//
// Flow:
// 1. User taps "Connect Strava" -> state transitions `not_connected ->
//    opening`. We call promptAsync() from expo-auth-session.
// 2. expo-auth-session opens the Strava authorize page (deep-link if the
//    Strava app is installed; in-app browser fallback otherwise).
// 3. On callback, expo-auth-session returns { code, state }. We hold the
//    PKCE code_verifier and the originally-generated `state` from the
//    request object, then POST { code, code_verifier, redirect_uri,
//    state, expected_state } to /api/integrations/strava/connect.
// 4. Branch on HTTP status: 200 -> connected; 409 -> account_conflict;
//    4xx -> auth_error; 5xx -> network_error.
//
// Security notes:
// - PKCE end-to-end. expo-auth-session generates the verifier; we never
//   compute or store it ourselves outside the in-memory request object.
// - State nonce. expo-auth-session generates a random state when we set
//   `state: undefined` in the AuthRequest (it auto-fills); we capture
//   that as `expected_state` and validate server-side.
// - Server validates state before calling Strava, so an attacker
//   substituting an arbitrary code without the matching state is
//   rejected at our boundary -- before burning the code.
//
// "Powered by Strava" brand mark. Per Strava brand guidelines, any screen
// that surfaces "Connected to Strava" must show the official mark.
// `BrandMarkText` is a text-only placeholder; replace with the official
// SVG when the brand asset is added to apps/mobile/src/assets/.

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

export { postResponseToAction, stravaConnectReducer } from "./strava-machine";
export type {
  StravaConnectAction,
  StravaConnectState,
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

interface PostBody {
  code: string;
  code_verifier: string;
  redirect_uri: string;
  state: string;
  expected_state: string;
}

interface ApiCaller {
  (
    path: string,
    init: RequestInit & { body: string }
  ): Promise<{ status: number; body: unknown }>;
}

/**
 * Real HTTP poster, separated so tests can stub it without mocking the
 * global fetch.
 */
async function defaultPost(
  path: string,
  init: RequestInit & { body: string }
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
    state: string;
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
  // Track the last AuthRequest so we have code_verifier + state when the
  // OAuth callback returns. (The library exposes these on the request
  // object after makeAuthRequestAsync runs.)
  const authRequestRef = useRef<{
    codeVerifier: string;
    state: string;
    redirectUri: string;
  } | null>(null);

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "da2",
    path: REDIRECT_PATH,
  });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: stravaClientId,
      redirectUri,
      scopes: STRAVA_SCOPES,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      // expo-auth-session generates state when omitted (random nonce);
      // we capture request.state below.
    },
    STRAVA_DISCOVERY
  );

  // Mirror the latest request's verifier+state into the ref so the
  // promptAsync-result handler below can read them at callback time.
  useEffect(() => {
    if (authRequestOverride) {
      authRequestRef.current = authRequestOverride;
      return;
    }
    if (request?.codeVerifier && request?.state) {
      authRequestRef.current = {
        codeVerifier: request.codeVerifier,
        state: request.state,
        redirectUri,
      };
    }
  }, [request, redirectUri, authRequestOverride]);

  // React to OAuth callback (response from the system browser / deep-link).
  useEffect(() => {
    if (state.kind !== "opening") return;
    if (!response) return;
    if (response.type === "success" && response.params?.code) {
      dispatch({ type: "oauth_returned_code" });
      void postConnect(response.params.code, response.params.state);
    } else if (response.type === "cancel" || response.type === "dismiss") {
      dispatch({ type: "oauth_cancelled" });
    } else if (response.type === "error") {
      dispatch({ type: "post_4xx", reason: "oauth_error" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  async function postConnect(code: string, returnedState?: string) {
    const captured = authRequestRef.current;
    if (!captured) {
      dispatch({ type: "post_4xx", reason: "missing_request_state" });
      return;
    }
    const body: PostBody = {
      code,
      code_verifier: captured.codeVerifier,
      redirect_uri: captured.redirectUri,
      state: returnedState ?? captured.state,
      expected_state: captured.state,
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

  async function onConnect() {
    if (!stravaClientId) {
      dispatch({ type: "post_4xx", reason: "missing_client_id" });
      return;
    }
    dispatch({ type: "tap_connect" });
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
