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
  | "account_collision"
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
 * Thrown when a Postgres unique_violation (23505) on
 * `strava_tokens.athlete_strava_id` fires during upsert.
 *
 * This is the race-arbiter for the TOCTOU window between the
 * `findUserByAthleteStravaId` pre-check and the upsert: two concurrent
 * users connecting the same Strava account can both pass the pre-check,
 * but only one upsert can succeed. The loser hits the unique constraint;
 * we surface it as a typed error so the route handler returns 409
 * `strava_account_already_linked` instead of a generic 500.
 */
export class StravaAccountCollisionError extends StravaError {
  public readonly athleteStravaId: number | null;
  constructor(athleteStravaId: number | null) {
    super(
      "account_collision",
      `strava_tokens.athlete_strava_id collision (race after pre-check)`
    );
    this.name = "StravaAccountCollisionError";
    this.athleteStravaId = athleteStravaId;
  }
}
