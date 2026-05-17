// One-shot backfill script — run from apps/web/:
//   npx tsx --env-file /tmp/da2-prod.env scripts/run-backfill.mts

import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import { z } from "zod";

import { decrypt, encrypt } from "@/security/token-crypto";
import { normalizeSport } from "@/strava/sport-normalization";
import { StravaActivitySchema } from "@/strava/schemas";

const USER_ID = "0b4492f8-85cb-42ed-b504-a79f7a36d1b3";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLIENT_ID = process.env.STRAVA_CLIENT_ID!;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing required env vars");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function decodeBytea(value: string): Uint8Array {
  if (value.startsWith("\\x")) return new Uint8Array(Buffer.from(value.slice(2), "hex"));
  return new Uint8Array(Buffer.from(value, "base64"));
}

function toByteaHex(bytes: Uint8Array): string {
  return `\\x${Buffer.from(bytes).toString("hex")}`;
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await admin
    .from("strava_tokens")
    .select("access_token_enc, refresh_token_enc, expires_at, key_version")
    .eq("user_id", USER_ID)
    .maybeSingle<{
      access_token_enc: string;
      refresh_token_enc: string;
      expires_at: string;
      key_version: number;
    }>();

  if (error || !data) throw new Error(`Token lookup failed: ${error?.message}`);

  const now = Date.now();
  const expiresAt = new Date(data.expires_at).getTime();

  if (now >= expiresAt - 60_000) {
    console.log("Token expired, refreshing...");
    const refreshPlain = decrypt(decodeBytea(data.refresh_token_enc), data.key_version);
    const refreshToken = new TextDecoder().decode(refreshPlain);

    const res = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!res.ok) throw new Error(`Strava refresh failed: ${res.status}`);
    const r = await res.json() as { access_token: string; refresh_token: string; expires_at: number };

    const encA = encrypt(new TextEncoder().encode(r.access_token));
    const encR = encrypt(new TextEncoder().encode(r.refresh_token));
    await admin.from("strava_tokens").update({
      access_token_enc: toByteaHex(encA.ciphertext),
      refresh_token_enc: toByteaHex(encR.ciphertext),
      expires_at: new Date(r.expires_at * 1000).toISOString(),
      key_version: encA.keyVersion,
    }).eq("user_id", USER_ID);

    console.log("Token refreshed.");
    return r.access_token;
  }

  return new TextDecoder().decode(decrypt(decodeBytea(data.access_token_enc), data.key_version));
}

async function main() {
  console.log("Starting Strava backfill for", USER_ID);
  const token = await getAccessToken();
  console.log("Got access token.");

  await admin.from("athlete_profiles").update({
    backfill_status: { provider: "strava", state: "in_progress", completed: 0, estimated_total: 200 },
  }).eq("user_id", USER_ID);

  let page = 1;
  let total = 0;

  while (total < 200) {
    console.log(`Fetching page ${page}...`);
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (res.status === 429) { console.error("Rate limited."); break; }
    if (!res.ok) { console.error(`Strava error: ${res.status}`); break; }

    const usage = res.headers.get("x-ratelimit-usage");
    if (usage) console.log(`  Rate limit (15min,daily): ${usage}`);

    const activities = z.array(StravaActivitySchema).parse(await res.json());
    console.log(`  ${activities.length} activities on page ${page}`);
    if (activities.length === 0) break;

    for (const act of activities.slice(0, 200 - total)) {
      const row = {
        athlete_id: USER_ID,
        source: "strava" as const,
        strava_activity_id: act.id,
        started_at: act.start_date,
        sport: normalizeSport(act.sport_type),
        distance_m: act.distance != null ? Math.round(act.distance) : null,
        duration_s: act.moving_time ?? act.elapsed_time ?? null,
        summary_stats: {} as Record<string, unknown>,
      };

      const { error: insErr } = await admin.from("completed_workouts").insert(row);
      if (insErr?.code === "23505") {
        await admin.from("completed_workouts").update({
          sport: row.sport,
          distance_m: row.distance_m,
          duration_s: row.duration_s,
        }).eq("athlete_id", USER_ID).eq("strava_activity_id", act.id);
      } else if (insErr) {
        console.warn(`  Skip activity ${act.id}: ${insErr.message}`);
      }
      total++;
    }

    console.log(`  Running total: ${total}`);
    if (activities.length < 200) break;
    page++;
  }

  await admin.from("athlete_profiles").update({
    backfill_status: { provider: "strava", state: "complete", completed: total },
  }).eq("user_id", USER_ID);

  console.log(`\nDone. ${total} activities imported.`);

  // Final counts by sport
  const { data: counts } = await admin
    .from("completed_workouts")
    .select("sport")
    .eq("athlete_id", USER_ID)
    .is("deleted_at", null);

  if (counts) {
    const byS: Record<string, number> = {};
    for (const r of counts) byS[r.sport] = (byS[r.sport] ?? 0) + 1;
    console.log("By sport:", byS);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
