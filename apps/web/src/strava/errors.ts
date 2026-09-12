// Typed errors surfaced by the Strava client + connect/webhook handlers.
//
// Each error captures enough context for the caller (route handler or
// Inngest function) to translate it into a normalized HTTP response or a
// `backfill_status` transition WITHOUT leaking Strava response bodies into
// logs. The `cause` field is preserved on the prototype chain for
// debugging; the `code` field is the stable wire identifier callers use to
// branch.

export type StravaErrorCode =
  | "needs_reauth"
  | "rate_limited"
  | "key_rotation"
  | "network"
  | "unexpected";

export class StravaError extends Error {
  public readonly code: StravaErrorCode;
  public readonly status?: number;

  constructor(code: StravaErrorCode, message: string, status?: number) {
    super(message);
    this.name = "StravaError";
    this.code = code;
    this.status = status;
  }
}

export class StravaReauthRequired extends StravaError {
  constructor(message = "Strava refresh token rejected; re-auth required") {
    super("needs_reauth", message, 401);
    this.name = "StravaReauthRequired";
  }
}

export class StravaRateLimited extends StravaError {
  public readonly retryAfterSeconds?: number;
  constructor(message: string, retryAfterSeconds?: number) {
    super("rate_limited", message, 429);
    this.name = "StravaRateLimited";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class StravaKeyRotationError extends StravaError {
  public readonly missingKeyVersion: number;
  constructor(missingKeyVersion: number) {
    super(
      "key_rotation",
      `STRAVA_TOKEN_KEYS does not contain key version ${missingKeyVersion}; cannot decrypt`
    );
    this.name = "StravaKeyRotationError";
    this.missingKeyVersion = missingKeyVersion;
  }
}

/**
 * Classify an unknown thrown value into a closed StravaBackfillErrorCode.
 * Never echoes err.message into the return value — only stable code strings.
 */
export function classifyError(err: unknown): import("@da2/shared").StravaBackfillErrorCode {
  if (err instanceof StravaReauthRequired) return "needs_reauth";
  if (err instanceof StravaKeyRotationError) return "key_rotation";
  if (err instanceof StravaRateLimited) return "rate_limited";
  if (err instanceof StravaError && err.code === "network") return "network";
  return "unknown";
}
