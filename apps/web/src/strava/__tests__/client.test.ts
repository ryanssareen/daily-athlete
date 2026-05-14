// Unit tests for the per-user Strava client (apps/web/src/strava/client.ts).
//
// These tests use:
// - msw (Mock Service Worker) to intercept Strava's REST + OAuth endpoints.
//   The shared handlers live in msw-handlers.ts and are reused by Phase
//   C/D suites.
// - A hand-rolled in-memory supabase-js look-alike (`fakeAdmin` below).
//   We don't need a real DB here -- the client only touches one table via
//   a narrow .from('strava_tokens').select/update fluent chain, which is
//   trivial to fake. A full local-supabase round trip would be slower and
//   would couple this unit test to DB schema state that the B2 route test
//   already exercises.
//
// Both the client-under-test and these tests import token-crypto with the
// same STRAVA_TOKEN_KEYS env, so encrypt(...) outputs are decryptable
// inside the fake DB layer (we encrypt at test setup and let the client
// decrypt on read -- exactly the production path).
//
// BYTEA write format: production wraps ciphertext as `\x<hex>` strings
// before passing to supabase-js (so PostgREST stores them as BYTEA via
// JSON). The fake below stores whatever the client passes and reads it
// back unchanged; we assert the write path uses `\x<hex>` (not
// Uint8Array) in the refresh test.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.STRAVA_TOKEN_KEYS =
    "1:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
  process.env.STRAVA_OAUTH_STATE_SIGNING_KEY =
    "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  process.env.STRAVA_CLIENT_ID = "test-client-id";
  process.env.STRAVA_CLIENT_SECRET = "test-client-secret";
});

import { setupServer } from "msw/node";

import { decrypt, encrypt } from "@/security/token-crypto";

import { createStravaClient } from "../client";
import {
  StravaKeyRotationError,
  StravaRateLimited,
  StravaReauthRequired,
} from "../errors";
import {
  createMockState,
  stravaApiHandlers,
  type StravaMockState,
} from "./msw-handlers";

let mockState: StravaMockState;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  mockState = createMockState();
  server.use(...stravaApiHandlers(mockState));
});

interface FakeRow {
  user_id: string;
  // Stored as the production wire format: `\x<hex>` strings (BYTEA literal).
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: string;
  key_version: number;
  last_used_at: string | null;
}

interface FakeAdmin {
  rows: Map<string, FakeRow>;
  asSupabase: () => unknown;
}

function bytesToHexLiteral(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

function hexLiteralToBytes(literal: string): Uint8Array {
  if (literal.startsWith("\\x")) {
    return new Uint8Array(Buffer.from(literal.slice(2), "hex"));
  }
  return new Uint8Array(Buffer.from(literal, "base64"));
}

function makeFakeAdmin(initialRow: FakeRow): FakeAdmin {
  const rows = new Map<string, FakeRow>();
  rows.set(initialRow.user_id, initialRow);

  function from(table: string) {
    if (table !== "strava_tokens") {
      throw new Error(`fakeAdmin unexpected table: ${table}`);
    }
    return new TableBuilder(rows);
  }

  return {
    rows,
    asSupabase: () => ({ from }),
  };
}

class TableBuilder {
  constructor(private readonly rows: Map<string, FakeRow>) {}
  select(_cols: string) {
    return new SelectBuilder(this.rows);
  }
  update(patch: Partial<FakeRow>) {
    return new UpdateBuilder(this.rows, patch);
  }
}

class SelectBuilder {
  private filter: { col: string; value: unknown } | null = null;
  constructor(private readonly rows: Map<string, FakeRow>) {}
  eq(col: string, value: unknown) {
    this.filter = { col, value };
    return this;
  }
  async maybeSingle<T>(): Promise<{ data: T | null; error: null }> {
    if (!this.filter || this.filter.col !== "user_id") {
      throw new Error("fakeAdmin: select supports only .eq('user_id', ...)");
    }
    const row = this.rows.get(this.filter.value as string);
    if (!row) return { data: null, error: null };
    // Return the literal in its PostgREST-default `\x<hex>` form -- the
    // client's decodeBytea handles both that and base64.
    const out = {
      access_token_enc: row.access_token_enc,
      refresh_token_enc: row.refresh_token_enc,
      expires_at: row.expires_at,
      key_version: row.key_version,
    } as unknown as T;
    return { data: out, error: null };
  }
}

class UpdateBuilder {
  private filter: { col: string; value: unknown } | null = null;
  constructor(
    private readonly rows: Map<string, FakeRow>,
    private readonly patch: Partial<FakeRow>
  ) {}
  eq(col: string, value: unknown) {
    this.filter = { col, value };
    return this;
  }
  then<TResult1 = { error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: null; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
  private async execute(): Promise<{ data: null; error: null }> {
    if (!this.filter || this.filter.col !== "user_id") {
      throw new Error("fakeAdmin: update supports only .eq('user_id', ...)");
    }
    const row = this.rows.get(this.filter.value as string);
    if (!row) return { data: null, error: null };
    Object.assign(row, this.patch);
    return { data: null, error: null };
  }
}

function buildSeedRow(opts: {
  userId: string;
  accessPlain: string;
  refreshPlain: string;
  expiresAtIso?: string;
  keyVersion?: number;
}): FakeRow {
  const encAccess = encrypt(new TextEncoder().encode(opts.accessPlain));
  const encRefresh = encrypt(new TextEncoder().encode(opts.refreshPlain));
  return {
    user_id: opts.userId,
    access_token_enc: bytesToHexLiteral(encAccess.ciphertext),
    refresh_token_enc: bytesToHexLiteral(encRefresh.ciphertext),
    expires_at: opts.expiresAtIso ?? "2026-05-14T12:00:00+00:00",
    key_version: opts.keyVersion ?? encAccess.keyVersion,
    last_used_at: null,
  };
}

describe("StravaClient happy path", () => {
  it("issues a Bearer-authenticated request and captures rate-limit headers", async () => {
    const row = buildSeedRow({
      userId: "11111111-1111-1111-1111-111111111111",
      accessPlain: "access-1",
      refreshPlain: "refresh-1",
    });
    const fake = makeFakeAdmin(row);

    mockState.apiResponses["/athlete"] = [
      {
        kind: "ok",
        body: { id: 9999 },
        rateLimits: { limit: "100,1000", usage: "5,12" },
      },
    ];

    const client = createStravaClient(
      row.user_id,
      fake.asSupabase() as never
    );
    const res = await client.fetch("/athlete");
    expect(res.status).toBe(200);
    await res.json();
    expect(client.rateLimits.fifteenMin).toEqual({ used: 5, limit: 100 });
    expect(client.rateLimits.daily).toEqual({ used: 12, limit: 1000 });
  });
});

describe("StravaClient refresh-on-401", () => {
  it("refreshes atomically, writes BYTEA hex strings, re-reads on retry, and succeeds", async () => {
    const userId = "22222222-2222-2222-2222-222222222222";
    const row = buildSeedRow({
      userId,
      accessPlain: "access-old",
      refreshPlain: "refresh-old",
    });
    const originalAccessEnc = row.access_token_enc;
    const originalRefreshEnc = row.refresh_token_enc;
    const fake = makeFakeAdmin(row);

    mockState.apiResponses["/athlete"] = [
      { kind: "auth-expired-401" },
      {
        kind: "ok",
        body: { id: 9999 },
        rateLimits: { limit: "100,1000", usage: "6,13" },
      },
    ];
    mockState.refresh.push({
      kind: "ok",
      payload: {
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_at: Math.floor(Date.UTC(2026, 4, 14, 18, 0, 0) / 1000),
      },
    });

    const client = createStravaClient(userId, fake.asSupabase() as never);
    const res = await client.fetch("/athlete");
    expect(res.status).toBe(200);

    // Refresh was attempted once and used the old refresh_token.
    expect(mockState.refreshCalls).toHaveLength(1);
    expect(mockState.refreshCalls[0]!.refresh_token).toBe("refresh-old");

    // Persisted row reflects BOTH new tokens, atomically (single UPDATE).
    const persisted = fake.rows.get(userId)!;
    expect(persisted.expires_at).toBe("2026-05-14T18:00:00.000Z");
    // BYTEA write contract: strings prefixed with `\x`.
    expect(typeof persisted.access_token_enc).toBe("string");
    expect(persisted.access_token_enc.startsWith("\\x")).toBe(true);
    expect(persisted.access_token_enc).not.toBe(originalAccessEnc);
    expect(persisted.refresh_token_enc).not.toBe(originalRefreshEnc);
    // Round-trip decrypt confirms the new plaintext is present.
    const decryptedAccess = new TextDecoder().decode(
      decrypt(
        hexLiteralToBytes(persisted.access_token_enc),
        persisted.key_version
      )
    );
    expect(decryptedAccess).toBe("access-new");
  });

  it("concurrent refresh: loser uses winner's persisted refresh_token (forceReload)", async () => {
    // Two StravaClient instances for the same user. Both hit a 401 in
    // sequence; the second instance must read the winner's already-
    // persisted refresh_token rather than reuse its own stale in-memory
    // copy. Without forceReload at the top of refreshTokens(), the
    // second instance would post refresh-old to Strava and (since the
    // queue only has refresh-mid available) misbehave.
    const userId = "concurrent-refresh";
    const row = buildSeedRow({
      userId,
      accessPlain: "access-old",
      refreshPlain: "refresh-old",
    });
    const fake = makeFakeAdmin(row);

    // First client refreshes successfully and writes "refresh-mid".
    mockState.apiResponses["/athlete"] = [
      { kind: "auth-expired-401" },
      { kind: "ok", body: { id: 1 } },
    ];
    mockState.refresh.push({
      kind: "ok",
      payload: {
        access_token: "access-mid",
        refresh_token: "refresh-mid",
        expires_at: Math.floor(Date.UTC(2026, 4, 14, 18, 0, 0) / 1000),
      },
    });

    const client1 = createStravaClient(userId, fake.asSupabase() as never);
    const res1 = await client1.fetch("/athlete");
    expect(res1.status).toBe(200);
    expect(mockState.refreshCalls).toHaveLength(1);
    expect(mockState.refreshCalls[0]!.refresh_token).toBe("refresh-old");

    // Now a SECOND client wakes up with an old in-memory state -- it
    // was constructed before the refresh, so its tokenCache would still
    // hold "refresh-old" if it had pre-loaded. Instead, the client's
    // refresh path calls ensureTokens(true) at the top, which reloads
    // the row (now holding refresh-mid) BEFORE posting to /oauth/token.
    // The msw queue is scripted to return refresh-final ONLY when
    // refresh_token=refresh-mid arrives.
    mockState.apiResponses["/athlete"] = [
      { kind: "auth-expired-401" },
      { kind: "ok", body: { id: 2 } },
    ];
    mockState.refresh.push({
      kind: "ok",
      payload: {
        access_token: "access-final",
        refresh_token: "refresh-final",
        expires_at: Math.floor(Date.UTC(2026, 4, 14, 19, 0, 0) / 1000),
      },
    });

    const client2 = createStravaClient(userId, fake.asSupabase() as never);
    const res2 = await client2.fetch("/athlete");
    expect(res2.status).toBe(200);
    // Critical assertion: the second client's refresh POST carried the
    // WINNER's refresh_token (refresh-mid), not its own stale view of
    // refresh-old. This is the forceReload guarantee.
    expect(mockState.refreshCalls).toHaveLength(2);
    expect(mockState.refreshCalls[1]!.refresh_token).toBe("refresh-mid");
  });

  it("call 401 + refresh ok + retry 401 -> throws StravaReauthRequired (T-01)", async () => {
    // Plan-mandated behavior: a 401 that survives a successful refresh
    // means the user revoked from Strava's side mid-flight. Surface as
    // a typed error so Inngest callers can branch without status-code
    // introspection.
    const userId = "double-401";
    const row = buildSeedRow({
      userId,
      accessPlain: "a",
      refreshPlain: "r",
    });
    const fake = makeFakeAdmin(row);

    mockState.apiResponses["/athlete"] = [
      { kind: "auth-expired-401" },
      { kind: "auth-expired-401" },
    ];
    mockState.refresh.push({
      kind: "ok",
      payload: {
        access_token: "a2",
        refresh_token: "r2",
        expires_at: Math.floor(Date.UTC(2026, 4, 14, 18, 0, 0) / 1000),
      },
    });

    const client = createStravaClient(userId, fake.asSupabase() as never);
    await expect(client.fetch("/athlete")).rejects.toBeInstanceOf(
      StravaReauthRequired
    );
  });

  it("does NOT refresh when 401 body reads as rate-limit (Strava daily quota)", async () => {
    const userId = "33333333-3333-3333-3333-333333333333";
    const row = buildSeedRow({
      userId,
      accessPlain: "access-rate",
      refreshPlain: "refresh-rate",
    });
    const fake = makeFakeAdmin(row);

    mockState.apiResponses["/athlete"] = [{ kind: "rate-limit-401" }];

    const client = createStravaClient(userId, fake.asSupabase() as never);
    await expect(client.fetch("/athlete")).rejects.toBeInstanceOf(
      StravaRateLimited
    );
    expect(mockState.refreshCalls).toHaveLength(0);
  });

  it("surfaces StravaReauthRequired when the refresh endpoint itself returns 400 invalid_grant", async () => {
    const userId = "44444444-4444-4444-4444-444444444444";
    const row = buildSeedRow({
      userId,
      accessPlain: "access-x",
      refreshPlain: "refresh-x",
    });
    const fake = makeFakeAdmin(row);

    mockState.apiResponses["/athlete"] = [{ kind: "auth-expired-401" }];
    mockState.refresh.push({ kind: "invalid-grant" });

    const client = createStravaClient(userId, fake.asSupabase() as never);
    await expect(client.fetch("/athlete")).rejects.toBeInstanceOf(
      StravaReauthRequired
    );
  });

  it("returns the 429 response without auto-retry (caller decides backoff)", async () => {
    const userId = "55555555-5555-5555-5555-555555555555";
    const row = buildSeedRow({
      userId,
      accessPlain: "a",
      refreshPlain: "r",
    });
    const fake = makeFakeAdmin(row);

    mockState.apiResponses["/athlete"] = [
      { kind: "429", rateLimits: { limit: "100,1000", usage: "99,500" } },
    ];

    const client = createStravaClient(userId, fake.asSupabase() as never);
    const res = await client.fetch("/athlete");
    expect(res.status).toBe(429);
    expect(client.rateLimits.fifteenMin).toEqual({ used: 99, limit: 100 });
    expect(mockState.refreshCalls).toHaveLength(0);
  });
});

describe("StravaClient key rotation", () => {
  it("throws StravaKeyRotationError when the row's key_version is not in env (asserts missingKeyVersion)", async () => {
    const userId = "66666666-6666-6666-6666-666666666666";
    const row = buildSeedRow({
      userId,
      accessPlain: "a",
      refreshPlain: "r",
    });
    // Force a key_version the env doesn't carry.
    row.key_version = 99;
    const fake = makeFakeAdmin(row);

    const client = createStravaClient(userId, fake.asSupabase() as never);
    const err = await client.fetch("/athlete").catch((e) => e);
    expect(err).toBeInstanceOf(StravaKeyRotationError);
    // Phase C/D callers use missingKeyVersion to decide whether to alert
    // operators on a key-rotation regression.
    expect((err as StravaKeyRotationError).missingKeyVersion).toBe(99);
  });
});

describe("StravaClient missing token row", () => {
  it("throws StravaReauthRequired when no row exists for the user", async () => {
    const fake = makeFakeAdmin(
      buildSeedRow({
        userId: "77777777-7777-7777-7777-777777777777",
        accessPlain: "a",
        refreshPlain: "r",
      })
    );

    const client = createStravaClient(
      "88888888-8888-8888-8888-888888888888",
      fake.asSupabase() as never
    );
    await expect(client.fetch("/athlete")).rejects.toBeInstanceOf(
      StravaReauthRequired
    );
  });
});

describe("StravaClient touchLastUsed", () => {
  it("is explicit-only and updates last_used_at when called", async () => {
    const userId = "99999999-9999-9999-9999-999999999999";
    const row = buildSeedRow({
      userId,
      accessPlain: "a",
      refreshPlain: "r",
    });
    const fake = makeFakeAdmin(row);

    mockState.apiResponses["/athlete"] = [
      { kind: "ok", body: { id: 1 } },
      { kind: "ok", body: { id: 1 } },
    ];

    const client = createStravaClient(userId, fake.asSupabase() as never);
    await client.fetch("/athlete");
    await client.fetch("/athlete");
    expect(fake.rows.get(userId)!.last_used_at).toBeNull();

    await client.touchLastUsed();
    expect(fake.rows.get(userId)!.last_used_at).not.toBeNull();
  });
});
