// Regression coverage for refresh-token rotation races: two OAuth-proxy
// processes for the same client can wake up and refresh the same near-expiry
// token near-simultaneously. The loser presents an already-rotated token,
// which must not be treated as replay/theft -- see the grace window in
// rotateRefresh (apps/web/src/oauth/tokens.ts).
//
// Prerequisites: `supabase start`.

import { describe, expect, it } from "vitest";

import { hashToken } from "@/oauth/crypto";
import { issueTokens, rotateRefresh } from "@/oauth/tokens";

import { createTestUser, seedOAuthClient, serviceClient } from "./setup";

describe("rotateRefresh reuse handling", () => {
  it("a token presented again immediately after rotation is rejected without burning the family", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const clientId = await seedOAuthClient(admin);
    const minted = await issueTokens(admin, {
      clientId,
      userId: athlete.id,
      scope: null,
      resource: "https://example.test/api/mcp",
    });

    const winner = await rotateRefresh(admin, minted.refreshToken);
    expect(winner.result).toBe("ok");

    // Simulate a second, racing process presenting the same (now-rotated)
    // refresh token a moment later.
    const loser = await rotateRefresh(admin, minted.refreshToken);
    expect(loser.result).toBe("invalid");

    // The winner's freshly issued tokens must still be live -- a genuine
    // theft response would have revoked the whole family, including these.
    if (winner.result !== "ok") throw new Error("unreachable");
    const stillGood = await rotateRefresh(admin, winner.tokens.refreshToken);
    expect(stillGood.result).toBe("ok");
  });

  it("a token presented long after rotation is treated as theft and burns the family", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const clientId = await seedOAuthClient(admin);
    const minted = await issueTokens(admin, {
      clientId,
      userId: athlete.id,
      scope: null,
      resource: "https://example.test/api/mcp",
    });

    const winner = await rotateRefresh(admin, minted.refreshToken);
    expect(winner.result).toBe("ok");
    if (winner.result !== "ok") throw new Error("unreachable");

    // Push this row's revocation outside the grace window to simulate a
    // token replayed well after rotation (real theft), not a race.
    await admin
      .from("oauth_access_tokens")
      .update({ revoked_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("refresh_token_hash", hashToken(minted.refreshToken));

    const replay = await rotateRefresh(admin, minted.refreshToken);
    expect(replay.result).toBe("reuse");

    // The whole family, including the legitimately rotated tokens, is burned.
    const afterTheft = await rotateRefresh(admin, winner.tokens.refreshToken);
    expect(afterTheft.result).toBe("invalid");
  });
});
