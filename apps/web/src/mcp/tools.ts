import "server-only";

// MCP tool surface: CRUD over the connected athlete's own stats. Every tool runs
// under an RLS-bound client minted from the bearer identity (see identity.ts), so
// Postgres scopes all reads/writes to that user. Reads project explicit column
// lists (output.ts); writes stamp `agent` attribution and append a workout_edits
// audit row. A targeted write affecting 0 rows is reported as
// `not_found_or_forbidden`, never a silent success.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SportSchema } from "@da2/shared";
import { buildLoadSeries, type LoadWorkoutInput } from "@/training-load";
import { isValidIanaTimezone } from "@/lib/timezone";

import { rlsClientFromAuth } from "./identity";
import {
  COMPLETED_SELECT,
  PLANNED_SELECT,
  PLAN_SELECT,
  PROFILE_SELECT,
  projectCompleted,
} from "./output";

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}
function fail(code: string, message?: string): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: code, message }) }],
    isError: true,
  };
}
// DB failures: log the raw driver message server-side, return only a generic
// code to the model (never leak PostgREST/schema internals into a tool payload).
function dbFail(code: string, error: { message?: string } | null): CallToolResult {
  if (error?.message) console.warn(`[mcp] ${code}: ${error.message}`);
  return fail(code);
}

interface Ctx {
  supabase: SupabaseClient;
  userId: string;
}
function ctxFrom(extra: { authInfo?: AuthInfo }): Ctx {
  const { supabase, identity } = rlsClientFromAuth(extra.authInfo);
  return { supabase, userId: identity.userId };
}

const ISO = z.string().datetime({ offset: true });
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const LIMIT = z.number().int().min(1).max(200).optional();

/** Append an agent-attributed audit row (RLS self_insert from migration 0025). */
async function appendAgentEdit(
  { supabase, userId }: Ctx,
  plannedWorkoutId: string,
  fieldDiff: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from("workout_edits").insert({
    athlete_id: userId,
    planned_workout_id: plannedWorkoutId,
    actor_role: "agent",
    actor_user_id: userId,
    field_diff: fieldDiff,
  });
  // The mutation already landed; never silently drop a failed audit append —
  // surface it in logs so the provenance gap is observable.
  if (error) {
    console.warn(`[mcp] audit append failed for planned_workout ${plannedWorkoutId}: ${error.message}`);
  }
}

export function registerAllTools(server: McpServer): void {
  // ---- READ -------------------------------------------------------------

  server.registerTool(
    "profile_get",
    {
      title: "Get athlete profile",
      description:
        "Read your editable profile fields (thresholds, weight, availability) and timezone.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (_args, extra) => {
      const { supabase, userId } = ctxFrom(extra);
      const [profile, userRow] = await Promise.all([
        supabase.from("athlete_profiles").select(PROFILE_SELECT).maybeSingle(),
        // timezone lives on users, not athlete_profiles -- a separate table.
        supabase.from("users").select("timezone").eq("id", userId).maybeSingle(),
      ]);
      if (profile.error) return dbFail("read_failed", profile.error);
      if (userRow.error) return dbFail("read_failed", userRow.error);
      const timezone = (userRow.data?.timezone as string | null) ?? "UTC";
      if (!profile.data) return ok({ manual_fields: {}, updated_at: null, timezone });
      return ok({ ...profile.data, timezone });
    }
  );

  server.registerTool(
    "workouts_completed_list",
    {
      title: "List completed workouts",
      description: "List your logged/imported workouts, most recent first.",
      inputSchema: { from: DATE.optional(), to: DATE.optional(), limit: LIMIT },
      annotations: { readOnlyHint: true },
    },
    async (args, extra) => {
      const { supabase } = ctxFrom(extra);
      let q = supabase
        .from("completed_workouts")
        .select(COMPLETED_SELECT)
        .is("deleted_at", null)
        .order("started_at", { ascending: false })
        .limit(args.limit ?? 50);
      if (args.from) q = q.gte("started_at", args.from);
      if (args.to) q = q.lte("started_at", `${args.to}T23:59:59Z`);
      const { data, error } = await q;
      if (error) return dbFail("read_failed", error);
      return ok({ workouts: (data ?? []).map(projectCompleted) });
    }
  );

  server.registerTool(
    "workouts_completed_get",
    {
      title: "Get a completed workout",
      description: "Read one of your completed workouts by id.",
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async (args, extra) => {
      const { supabase } = ctxFrom(extra);
      const { data, error } = await supabase
        .from("completed_workouts")
        .select(COMPLETED_SELECT)
        .eq("id", args.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) return dbFail("read_failed", error);
      if (!data) return fail("not_found_or_forbidden");
      return ok(projectCompleted(data));
    }
  );

  server.registerTool(
    "workouts_planned_list",
    {
      title: "List planned workouts",
      description: "List upcoming/scheduled workouts in your plan.",
      inputSchema: { from: DATE.optional(), to: DATE.optional(), limit: LIMIT },
      annotations: { readOnlyHint: true },
    },
    async (args, extra) => {
      const { supabase } = ctxFrom(extra);
      let q = supabase
        .from("planned_workouts")
        .select(PLANNED_SELECT)
        .is("deleted_at", null)
        .order("scheduled_date", { ascending: true })
        .limit(args.limit ?? 100);
      if (args.from) q = q.gte("scheduled_date", args.from);
      if (args.to) q = q.lte("scheduled_date", args.to);
      const { data, error } = await q;
      if (error) return dbFail("read_failed", error);
      return ok({ workouts: data ?? [] });
    }
  );

  server.registerTool(
    "workouts_planned_get",
    {
      title: "Get a planned workout",
      description: "Read one planned workout by id (includes the version token for edits).",
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async (args, extra) => {
      const { supabase } = ctxFrom(extra);
      const { data, error } = await supabase
        .from("planned_workouts")
        .select(PLANNED_SELECT)
        .eq("id", args.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) return dbFail("read_failed", error);
      if (!data) return fail("not_found_or_forbidden");
      return ok(data);
    }
  );

  server.registerTool(
    "plans_list",
    {
      title: "List training plans",
      description: "List your training plans (active and archived).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async (_args, extra) => {
      const { supabase } = ctxFrom(extra);
      const { data, error } = await supabase
        .from("plans")
        .select(PLAN_SELECT)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) return dbFail("read_failed", error);
      return ok({ plans: data ?? [] });
    }
  );

  server.registerTool(
    "plans_get",
    {
      title: "Get a training plan",
      description: "Read one of your training plans by id.",
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: true },
    },
    async (args, extra) => {
      const { supabase } = ctxFrom(extra);
      const { data, error } = await supabase
        .from("plans")
        .select(PLAN_SELECT)
        .eq("id", args.id)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) return dbFail("read_failed", error);
      if (!data) return fail("not_found_or_forbidden");
      return ok(data);
    }
  );

  server.registerTool(
    "training_load_summary",
    {
      title: "Training load summary",
      description:
        "Compute your current training load (CTL/ATL/TSB) and recent trend from completed workouts.",
      inputSchema: { days: z.number().int().min(7).max(365).optional() },
      annotations: { readOnlyHint: true },
    },
    async (args, extra) => {
      const { supabase } = ctxFrom(extra);
      const days = args.days ?? 90;
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("completed_workouts")
        .select("started_at, duration_s, summary_stats")
        .is("deleted_at", null)
        .gte("started_at", since)
        .order("started_at", { ascending: true });
      if (error) return dbFail("read_failed", error);
      const inputs: LoadWorkoutInput[] = (data ?? []).map((w) => ({
        started_at: w.started_at as string,
        duration_s: (w.duration_s as number | null) ?? null,
        summary_stats: (w.summary_stats as Record<string, unknown>) ?? {},
      }));
      const load = buildLoadSeries(inputs);
      return ok({
        window_days: days,
        workout_count: inputs.length,
        ctl: load.ctl,
        atl: load.atl,
        tsb: load.tsb,
        recent: load.series.slice(-14),
      });
    }
  );

  // ---- WRITE ------------------------------------------------------------

  server.registerTool(
    "profile_update",
    {
      title: "Update athlete profile",
      description:
        "Update your editable profile fields (thresholds, weight, availability) and/or your timezone.",
      inputSchema: {
        age: z.number().int().min(0).max(120).optional(),
        weight_kg: z.number().min(20).max(400).optional(),
        weekly_hours_avail: z.number().min(0).max(80).optional(),
        target_event: z.record(z.unknown()).optional(),
        timezone: z.string().min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args, extra) => {
      const { supabase, userId } = ctxFrom(extra);
      const { timezone, ...manualFieldArgs } = args;

      if (timezone !== undefined && !isValidIanaTimezone(timezone)) {
        return fail("invalid_input", `unrecognized timezone: ${timezone}`);
      }

      // timezone lives on users, not athlete_profiles -- write it separately
      // so a caller updating only their timezone doesn't fail just because
      // they have no athlete_profiles row yet (created at onboarding, unlike
      // the users row, which every account has from signup).
      const hasManualFieldEdits = Object.values(manualFieldArgs).some((v) => v !== undefined);
      if (!hasManualFieldEdits && timezone === undefined) {
        return fail("invalid_input", "no fields provided to update");
      }

      let profileData: Record<string, unknown> | null = null;
      if (hasManualFieldEdits) {
        const { data: cur, error: readErr } = await supabase
          .from("athlete_profiles")
          .select("manual_fields")
          .maybeSingle();
        if (readErr) return dbFail("read_failed", readErr);
        const merged: Record<string, unknown> = {
          ...((cur?.manual_fields as Record<string, unknown> | null) ?? {}),
        };
        for (const [k, v] of Object.entries(manualFieldArgs)) {
          if (v !== undefined) merged[k] = v;
        }
        // Writes ONLY the manual_fields column; baselines/derived state untouched.
        const { data, error } = await supabase
          .from("athlete_profiles")
          .update({ manual_fields: merged })
          .select(PROFILE_SELECT)
          .maybeSingle();
        if (error) return dbFail("write_failed", error);
        if (!data) return fail("not_found_or_forbidden");
        profileData = data;
      }

      if (timezone !== undefined) {
        // users_self_update's RLS policy already permits self-writes to
        // timezone (unlike role_flags -- see AGENTS.md's "Secrets" section).
        // This RLS-scoped client always carries a real minted JWT
        // (identity.ts), unlike @/auth/server's cookie-only client, so
        // auth.uid() resolves correctly here -- no admin-client workaround
        // needed, unlike PATCH /api/profile/timezone.
        const { error: tzErr } = await supabase
          .from("users")
          .update({ timezone })
          .eq("id", userId);
        if (tzErr) return dbFail("write_failed", tzErr);
      }

      return ok({
        ...(profileData ?? {}),
        ...(timezone !== undefined ? { timezone } : {}),
      });
    }
  );

  server.registerTool(
    "workouts_completed_log",
    {
      title: "Log a completed workout",
      description:
        "Log an ad-hoc completed workout. Note: this does not close out a planned plan day (matching is in-app only).",
      inputSchema: {
        started_at: ISO,
        sport: SportSchema,
        distance_m: z.number().nonnegative().optional(),
        duration_s: z.number().int().nonnegative().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args, extra) => {
      const { supabase, userId } = ctxFrom(extra);
      const { data, error } = await supabase
        .from("completed_workouts")
        .insert({
          athlete_id: userId, // RLS WITH CHECK (auth.uid() = athlete_id)
          source: "manual",
          started_at: args.started_at,
          sport: args.sport,
          distance_m: args.distance_m ?? null,
          duration_s: args.duration_s ?? null,
          summary_stats: {},
        })
        .select(COMPLETED_SELECT)
        .single();
      if (error) return dbFail("write_failed", error);
      return ok(projectCompleted(data));
    }
  );

  server.registerTool(
    "workouts_completed_edit",
    {
      title: "Edit a completed workout",
      description: "Edit fields of one of your completed workouts.",
      inputSchema: {
        id: z.string().uuid(),
        started_at: ISO.optional(),
        sport: SportSchema.optional(),
        distance_m: z.number().nonnegative().optional(),
        duration_s: z.number().int().nonnegative().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args, extra) => {
      const { supabase } = ctxFrom(extra);
      const patch: Record<string, unknown> = {};
      for (const k of ["started_at", "sport", "distance_m", "duration_s"] as const) {
        if (args[k] !== undefined) patch[k] = args[k];
      }
      if (Object.keys(patch).length === 0) return fail("invalid_input", "no fields to update");
      const { data, error } = await supabase
        .from("completed_workouts")
        .update(patch)
        .eq("id", args.id)
        .is("deleted_at", null)
        .select(COMPLETED_SELECT)
        .maybeSingle();
      if (error) return dbFail("write_failed", error);
      if (!data) return fail("not_found_or_forbidden");
      return ok(projectCompleted(data));
    }
  );

  server.registerTool(
    "workouts_completed_delete",
    {
      title: "Delete a completed workout",
      description: "Soft-delete a completed workout. Refused if it is matched to a plan day.",
      inputSchema: { id: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args, extra) => {
      const { supabase } = ctxFrom(extra);
      // Refuse if a match exists (unmatch is in-app only in v1). Fail SAFE: if
      // the match state can't be read, refuse rather than risk orphaning a match.
      const { data: match, error: matchErr } = await supabase
        .from("workout_matches")
        .select("id")
        .eq("completed_workout_id", args.id)
        .limit(1);
      if (matchErr) return dbFail("write_failed", matchErr);
      if (match && match.length > 0) {
        return fail("requires_in_app", "this workout is matched to a plan day; unmatch it in the app first");
      }
      const { data, error } = await supabase
        .from("completed_workouts")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", args.id)
        .is("deleted_at", null)
        .select("id")
        .maybeSingle();
      if (error) return dbFail("write_failed", error);
      if (!data) return fail("not_found_or_forbidden");
      return ok({ deleted: true, id: args.id });
    }
  );

  server.registerTool(
    "workouts_planned_create",
    {
      title: "Create a planned workout",
      description: "Add a planned workout to your calendar (optionally under a plan).",
      inputSchema: {
        scheduled_date: DATE,
        sport: SportSchema,
        planned_load: z.number().nonnegative().optional(),
        plan_id: z.string().uuid().optional(),
        rationale: z.string().max(2000).optional(),
        structure: z.record(z.unknown()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args, extra) => {
      const ctx = ctxFrom(extra);
      // planned_workouts.athlete_id is not SQL-tied to plans.athlete_id, so
      // verify the plan is the caller's before attaching (RLS scopes this read).
      if (args.plan_id) {
        const { data: plan, error: planErr } = await ctx.supabase
          .from("plans")
          .select("id")
          .eq("id", args.plan_id)
          .is("deleted_at", null)
          .maybeSingle();
        if (planErr) return dbFail("write_failed", planErr);
        if (!plan) return fail("not_found_or_forbidden", "plan not found");
      }
      const { data, error } = await ctx.supabase
        .from("planned_workouts")
        .insert({
          athlete_id: ctx.userId,
          plan_id: args.plan_id ?? null,
          scheduled_date: args.scheduled_date,
          sport: args.sport,
          structure: args.structure ?? {},
          planned_load: args.planned_load ?? null,
          status: "planned",
          rationale: args.rationale ?? null,
          edited_by_kind: "agent",
          edited_by_user_id: ctx.userId,
          edited_at: new Date().toISOString(),
        })
        .select(PLANNED_SELECT)
        .single();
      if (error) return dbFail("write_failed", error);
      await appendAgentEdit(ctx, data.id as string, { created: true });
      return ok(data);
    }
  );

  server.registerTool(
    "workouts_planned_edit",
    {
      title: "Edit a planned workout",
      description:
        "Edit a planned workout. Pass the current `version`; a mismatch returns stale_retry so you can re-read.",
      inputSchema: {
        id: z.string().uuid(),
        version: z.number().int(),
        scheduled_date: DATE.optional(),
        sport: SportSchema.optional(),
        planned_load: z.number().nonnegative().optional(),
        rationale: z.string().max(2000).optional(),
        structure: z.record(z.unknown()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args, extra) => {
      const ctx = ctxFrom(extra);
      const patch: Record<string, unknown> = {
        edited_by_kind: "agent",
        edited_by_user_id: ctx.userId,
        edited_at: new Date().toISOString(),
      };
      for (const k of ["scheduled_date", "sport", "planned_load", "rationale", "structure"] as const) {
        if (args[k] !== undefined) patch[k] = args[k];
      }
      const { data, error } = await ctx.supabase
        .from("planned_workouts")
        .update(patch)
        .eq("id", args.id)
        .eq("version", args.version)
        .is("deleted_at", null)
        .select(PLANNED_SELECT)
        .maybeSingle();
      if (error) return dbFail("write_failed", error);
      if (!data) {
        // Distinguish stale version from missing/forbidden row.
        const { data: cur } = await ctx.supabase
          .from("planned_workouts")
          .select("version")
          .eq("id", args.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (cur) return fail("stale_retry", `version is now ${cur.version}; re-read and retry`);
        return fail("not_found_or_forbidden");
      }
      await appendAgentEdit(ctx, args.id, { edited: Object.keys(patch) });
      return ok(data);
    }
  );

  server.registerTool(
    "workouts_planned_move",
    {
      title: "Move a planned workout",
      description: "Reschedule a planned workout to a new date. Pass the current `version`.",
      inputSchema: {
        id: z.string().uuid(),
        version: z.number().int(),
        scheduled_date: DATE,
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args, extra) => {
      const ctx = ctxFrom(extra);
      const { data, error } = await ctx.supabase
        .from("planned_workouts")
        .update({
          scheduled_date: args.scheduled_date,
          edited_by_kind: "agent",
          edited_by_user_id: ctx.userId,
          edited_at: new Date().toISOString(),
        })
        .eq("id", args.id)
        .eq("version", args.version)
        .is("deleted_at", null)
        .select(PLANNED_SELECT)
        .maybeSingle();
      if (error) return dbFail("write_failed", error);
      if (!data) {
        const { data: cur } = await ctx.supabase
          .from("planned_workouts")
          .select("version")
          .eq("id", args.id)
          .is("deleted_at", null)
          .maybeSingle();
        if (cur) return fail("stale_retry", `version is now ${cur.version}; re-read and retry`);
        return fail("not_found_or_forbidden");
      }
      await appendAgentEdit(ctx, args.id, { moved_to: args.scheduled_date });
      return ok(data);
    }
  );

  server.registerTool(
    "workouts_planned_delete",
    {
      title: "Delete a planned workout",
      description:
        "Soft-delete a planned workout. Pass the current `version` to guard against deleting a concurrently-edited workout.",
      inputSchema: { id: z.string().uuid(), version: z.number().int().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args, extra) => {
      const ctx = ctxFrom(extra);
      let del = ctx.supabase
        .from("planned_workouts")
        .update({
          deleted_at: new Date().toISOString(),
          edited_by_kind: "agent",
          edited_by_user_id: ctx.userId,
          edited_at: new Date().toISOString(),
        })
        .eq("id", args.id)
        .is("deleted_at", null);
      if (args.version !== undefined) del = del.eq("version", args.version);
      const { data, error } = await del.select("id").maybeSingle();
      if (error) return dbFail("write_failed", error);
      if (!data) {
        if (args.version !== undefined) {
          const { data: cur } = await ctx.supabase
            .from("planned_workouts")
            .select("version")
            .eq("id", args.id)
            .is("deleted_at", null)
            .maybeSingle();
          if (cur) return fail("stale_retry", `version is now ${cur.version}; re-read and retry`);
        }
        return fail("not_found_or_forbidden");
      }
      await appendAgentEdit(ctx, args.id, { deleted: true });
      return ok({ deleted: true, id: args.id });
    }
  );
}
