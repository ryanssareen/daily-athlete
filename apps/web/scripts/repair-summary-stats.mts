// One-shot repair for completed_workouts rows written by an older
// `buildSummaryStats` vintage — run from apps/web/:
//
//   # dry run, every connected athlete (default; writes nothing)
//   npx tsx --env-file /tmp/da2-prod.env scripts/repair-summary-stats.mts
//
//   # dry run, one athlete
//   npx tsx --env-file /tmp/da2-prod.env scripts/repair-summary-stats.mts --user <uuid>
//
//   # actually write
//   npx tsx --env-file /tmp/da2-prod.env scripts/repair-summary-stats.mts --apply
//
// Why this exists: `average_cadence` was added to the projection in
// 0c9fbf4 (2026-05-17 14:00 UTC) and `has_heartrate` in a1e337b
// (2026-05-18). Athletes whose backfill ran earlier carry rows missing
// those keys permanently — the backfill is one-shot and
// `hydrateStravaWorkout` only fires on first detail-page view.
//
// Every missing key is present on Strava's *summary* activity, so this
// pages `/athlete/activities` (1 call per 200 activities) rather than
// hitting the per-activity detail endpoint (1 call per activity). Against
// Strava's 100-req/15-min cap that is the difference between one call and
// two hundred for a typical athlete.
//
// The merge is fill-only (see `fillMissingSummaryStats`): it never
// overwrites a stored value, so it is idempotent and safe to re-run.

import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import { z } from "zod";

import { decrypt, encrypt } from "@/security/token-crypto";
import { fillMissingSummaryStats } from "@/strava/repair-summary-stats";
import { StravaActivitySchema } from "@/strava/schemas";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const CLIENT_ID = process.env.STRAVA_CLIENT_ID!;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing required env vars");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const userFlagIndex = process.argv.indexOf("--user");
const ONLY_USER = userFlagIndex !== -1 ? process.argv[userFlagIndex + 1] : null;

const PER_PAGE = 200;
// Matches the backfill's ceiling — we only repair rows we could have
// created, and the backfill never imported more than 200 per athlete.
const MAX_ACTIVITIES = 200;

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

/**
 * Resolve a usable access token for `userId`, refreshing + persisting the
 * rotated pair when the stored one is within 60s of expiry. Mirrors
 * `StravaClient`'s refresh path; the client itself is not reusable here
 * because it is wired for request-scoped Next.js execution.
 */
async function getAccessToken(userId: string): Promise<string> {
  const { data, error } = await admin
    .from("strava_tokens")
    .select("access_token_enc, refresh_token_enc, expires_at, key_version")
    .eq("user_id", userId)
    .maybeSingle<{
      access_token_enc: string;
      refresh_token_enc: string;
      expires_at: string;
      key_version: number;
    }>();

  if (error || !data) throw new Error(`Token lookup failed: ${error?.message ?? "no row"}`);

  if (Date.now() < new Date(data.expires_at).getTime() - 60_000) {
    return new TextDecoder().decode(decrypt(decodeBytea(data.access_token_enc), data.key_version));
  }

  const refreshToken = new TextDecoder().decode(
    decrypt(decodeBytea(data.refresh_token_enc), data.key_version)
  );

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
  const r = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  // Strava rotates BOTH tokens — persist the pair together or the next
  // run is locked out.
  const encA = encrypt(new TextEncoder().encode(r.access_token));
  const encR = encrypt(new TextEncoder().encode(r.refresh_token));
  await admin
    .from("strava_tokens")
    .update({
      access_token_enc: toByteaHex(encA.ciphertext),
      refresh_token_enc: toByteaHex(encR.ciphertext),
      expires_at: new Date(r.expires_at * 1000).toISOString(),
      key_version: encA.keyVersion,
    })
    .eq("user_id", userId);

  return r.access_token;
}

interface WorkoutRow {
  id: string;
  strava_activity_id: number;
  summary_stats: Record<string, unknown> | null;
}

async function repairAthlete(userId: string): Promise<void> {
  console.log(`\n── ${userId} ${"─".repeat(Math.max(0, 50 - userId.length))}`);

  // service-role: explicit user filter required
  const { data: rows, error } = await admin
    .from("completed_workouts")
    .select("id, strava_activity_id, summary_stats")
    .eq("athlete_id", userId)
    .eq("source", "strava")
    .is("deleted_at", null)
    .not("strava_activity_id", "is", null)
    .returns<WorkoutRow[]>();

  if (error) throw new Error(`Row fetch failed: ${error.message}`);
  if (!rows || rows.length === 0) {
    console.log("  no Strava-sourced workouts — skipping");
    return;
  }

  const byActivityId = new Map(rows.map((r) => [r.strava_activity_id, r]));
  console.log(`  ${rows.length} stored workouts`);

  const token = await getAccessToken(userId);

  let seen = 0;
  let repaired = 0;
  let unchanged = 0;
  let notStored = 0;
  const addedKeyCounts = new Map<string, number>();

  for (let page = 1; seen < MAX_ACTIVITIES; page++) {
    const res = await fetch(
      `https://www.strava.com/api/v3/athlete/activities?per_page=${PER_PAGE}&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (res.status === 429) {
      console.error("  rate limited — stopping this athlete; re-run later to finish");
      break;
    }
    if (!res.ok) {
      console.error(`  Strava error ${res.status} — stopping this athlete`);
      break;
    }

    const usage = res.headers.get("x-ratelimit-usage");
    if (usage) console.log(`  page ${page} · rate limit (15min,daily): ${usage}`);

    const activities = z.array(StravaActivitySchema).parse(await res.json());
    if (activities.length === 0) break;

    for (const act of activities) {
      if (seen >= MAX_ACTIVITIES) break;
      seen++;

      const row = byActivityId.get(act.id);
      if (!row) {
        // Present on Strava but never imported. Out of scope: this script
        // repairs existing rows, it does not create them.
        notStored++;
        continue;
      }

      const result = fillMissingSummaryStats(row.summary_stats, act);
      if (!result) {
        unchanged++;
        continue;
      }

      for (const key of result.added) {
        addedKeyCounts.set(key, (addedKeyCounts.get(key) ?? 0) + 1);
      }

      if (APPLY) {
        // service-role: explicit user filter required
        const { error: updErr } = await admin
          .from("completed_workouts")
          .update({ summary_stats: result.stats })
          .eq("id", row.id)
          .eq("athlete_id", userId);

        if (updErr) {
          console.warn(`  activity ${act.id}: update failed — ${updErr.message}`);
          continue;
        }
      }
      repaired++;
    }

    if (activities.length < PER_PAGE) break;
  }

  console.log(
    `  ${APPLY ? "repaired" : "would repair"}: ${repaired} · already complete: ${unchanged}` +
      (notStored > 0 ? ` · on Strava but not imported: ${notStored}` : "")
  );
  if (addedKeyCounts.size > 0) {
    const summary = [...addedKeyCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`)
      .join(" ");
    console.log(`  keys filled: ${summary}`);
  }
}

async function main() {
  console.log(APPLY ? "APPLY mode — writing changes" : "DRY RUN — pass --apply to write");

  let userIds: string[];
  if (ONLY_USER) {
    userIds = [ONLY_USER];
  } else {
    const { data, error } = await admin
      .from("strava_tokens")
      .select("user_id")
      .returns<{ user_id: string }[]>();
    if (error) throw new Error(`Token listing failed: ${error.message}`);
    userIds = (data ?? []).map((r) => r.user_id);
  }

  console.log(`${userIds.length} connected athlete(s) to process`);

  for (const userId of userIds) {
    try {
      await repairAthlete(userId);
    } catch (err) {
      // One athlete's expired refresh token must not abort the rest.
      console.error(`  FAILED ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(APPLY ? "\nDone." : "\nDone (dry run — nothing written).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
