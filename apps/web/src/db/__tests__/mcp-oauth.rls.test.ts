// RLS tests for the MCP OAuth tables (migration 0025) + the new workout_edits
// self-INSERT policy. Mandatory for new user-scoped tables. Confirms:
//   - oauth_access_tokens: athlete-self SELECT; a stranger sees 0 rows (AE1);
//     no client write path (service-role owns issuance).
//   - oauth_clients / oauth_authorization_codes: no client access at all (RLS
//     enabled, no policies) — global/ephemeral, AS-only.
//   - workout_edits: an athlete CAN append their own audit row (new self_insert
//     policy) but NOT one attributed to another athlete.
//   - account-deletion cascade removes a user's codes + tokens.
//
// RLS SELECT denial surfaces as 0 rows; write denial surfaces as an error.
// Prerequisites: `supabase start`.

import { describe, expect, it } from "vitest";

import { createTestUser, serviceClient } from "./setup";

type Admin = ReturnType<typeof serviceClient>;

async function seedClient(admin: Admin): Promise<string> {
  const clientId = `mcp_test_${crypto.randomUUID()}`;
  const { error } = await admin.from("oauth_clients").insert({
    client_id: clientId,
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
  });
  if (error) throw new Error(`seedClient: ${error.message}`);
  return clientId;
}

async function seedToken(admin: Admin, clientId: string, userId: string): Promise<void> {
  const { error } = await admin.from("oauth_access_tokens").insert({
    access_token_hash: `ah_${crypto.randomUUID()}`,
    refresh_token_hash: `rh_${crypto.randomUUID()}`,
    client_id: clientId,
    user_id: userId,
    family_id: crypto.randomUUID(),
    resource: "https://example.test/api/mcp",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  if (error) throw new Error(`seedToken: ${error.message}`);
}

describe("oauth_access_tokens RLS", () => {
  it("athlete can SELECT their own token row", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const clientId = await seedClient(admin);
    await seedToken(admin, clientId, athlete.id);

    const { data, error } = await athlete.client
      .from("oauth_access_tokens")
      .select("id, user_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.user_id).toBe(athlete.id);
  });

  it("a stranger cannot SELECT another athlete's token (0 rows) [AE1]", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    const clientId = await seedClient(admin);
    await seedToken(admin, clientId, athlete.id);

    const { data, error } = await stranger.client
      .from("oauth_access_tokens")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("no client INSERT path (service-role only)", async () => {
    const athlete = await createTestUser();
    const { error } = await athlete.client.from("oauth_access_tokens").insert({
      access_token_hash: `ah_${crypto.randomUUID()}`,
      client_id: "mcp_whatever",
      user_id: athlete.id,
      family_id: crypto.randomUUID(),
      resource: "https://example.test/api/mcp",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(error).not.toBeNull();
  });
});

describe("oauth_clients / oauth_authorization_codes RLS (no client access)", () => {
  it("a user JWT cannot read oauth_clients (no policy => 0 rows)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    await seedClient(admin);
    const { data, error } = await athlete.client.from("oauth_clients").select("client_id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a user JWT cannot read oauth_authorization_codes (no policy => 0 rows)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const clientId = await seedClient(admin);
    await admin.from("oauth_authorization_codes").insert({
      code_hash: `ch_${crypto.randomUUID()}`,
      client_id: clientId,
      user_id: athlete.id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: "x".repeat(43),
      resource: "https://example.test/api/mcp",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
    const { data, error } = await athlete.client
      .from("oauth_authorization_codes")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});

describe("workout_edits self-INSERT (migration 0025)", () => {
  it("athlete can append their own agent-attributed audit row", async () => {
    const athlete = await createTestUser();
    const { error } = await athlete.client.from("workout_edits").insert({
      athlete_id: athlete.id,
      actor_role: "agent",
      actor_user_id: athlete.id,
      field_diff: { created: true },
    });
    expect(error).toBeNull();
  });

  it("athlete cannot append an audit row attributed to another athlete", async () => {
    const athlete = await createTestUser();
    const stranger = await createTestUser();
    const { error } = await athlete.client.from("workout_edits").insert({
      athlete_id: stranger.id, // RLS WITH CHECK (auth.uid() = athlete_id) denies
      actor_role: "agent",
      field_diff: {},
    });
    expect(error).not.toBeNull();
  });
});

describe("MCP OAuth account-deletion cascade", () => {
  it("removes a user's tokens + codes on hard delete (FK ON DELETE CASCADE)", async () => {
    const admin = serviceClient();
    const athlete = await createTestUser();
    const clientId = await seedClient(admin);
    await seedToken(admin, clientId, athlete.id);
    await admin.from("oauth_authorization_codes").insert({
      code_hash: `ch_${crypto.randomUUID()}`,
      client_id: clientId,
      user_id: athlete.id,
      redirect_uri: "https://claude.ai/api/mcp/auth_callback",
      code_challenge: "x".repeat(43),
      resource: "https://example.test/api/mcp",
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    });

    await admin.auth.admin.deleteUser(athlete.id);

    const { data: tokens } = await admin
      .from("oauth_access_tokens")
      .select("id")
      .eq("user_id", athlete.id);
    const { data: codes } = await admin
      .from("oauth_authorization_codes")
      .select("id")
      .eq("user_id", athlete.id);
    expect(tokens ?? []).toHaveLength(0);
    expect(codes ?? []).toHaveLength(0);
  });
});
