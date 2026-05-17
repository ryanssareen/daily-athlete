// POST /api/onboarding/save
//
// Persists partial onboarding data for the authenticated athlete:
//   - `nickname` writes to public.users.display_name
//   - everything else merges into athlete_profiles.manual_fields
//
// The `manual_field_edited_at` map is maintained automatically by the
// athlete_profiles_stamp_manual_edits trigger (migration 0005), so this
// route only needs to write `manual_fields`.
//
// Athlete-self only — uses the JWT-bound supabase-js client so the
// athlete_profiles_self_insert / _self_update RLS policies arbitrate.
// First-touch uses upsert (ON CONFLICT (user_id) DO UPDATE) so that
// concurrent calls from a second tab don't collide.

import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient as createServerClient } from "@/auth/server";

const SaveRequestSchema = z
  .object({
    nickname: z.string().trim().min(1).max(80).optional(),
    primary_sport: z.enum(["tri", "run", "bike", "swim"]).optional(),
    weekly_hours_avail: z.number().int().min(1).max(40).optional(),
    training_pattern: z.string().trim().min(1).max(80).optional(),
    target_event: z
      .object({
        type: z.string().trim().min(1).max(80),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
      })
      .nullable()
      .optional(),
    completed: z.boolean().optional(),
  })
  .strict();

type SaveRequest = z.infer<typeof SaveRequestSchema>;

export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: SaveRequest;
  try {
    const json = await request.json();
    body = SaveRequestSchema.parse(json);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // 1. Update display_name on public.users if nickname provided.
  if (body.nickname !== undefined) {
    const { error: userErr } = await supabase
      .from("users")
      .update({ display_name: body.nickname })
      .eq("id", user.id);
    if (userErr) {
      return NextResponse.json(
        { error: "db_write_failed", detail: userErr.message },
        { status: 500 }
      );
    }
  }

  // 2. Compute the manual_fields patch we want to apply.
  const fieldsPatch: Record<string, unknown> = {};
  if (body.primary_sport !== undefined) fieldsPatch.primary_sport = body.primary_sport;
  if (body.weekly_hours_avail !== undefined) {
    fieldsPatch.weekly_hours_avail = body.weekly_hours_avail;
  }
  if (body.training_pattern !== undefined) {
    fieldsPatch.training_pattern = body.training_pattern;
  }
  if (body.target_event !== undefined) {
    // null clears the field; an object replaces it as a whole blob.
    if (body.target_event === null) {
      // We can't unset a key with a JSONB merge — handled below by reading
      // existing fields and rewriting.
      fieldsPatch.target_event = null;
    } else {
      fieldsPatch.target_event = body.target_event;
    }
  }
  if (body.completed) {
    fieldsPatch.onboarded_at = new Date().toISOString();
  }

  // 3. Apply the patch — read existing, merge, upsert.
  if (Object.keys(fieldsPatch).length > 0) {
    const { data: existing, error: readErr } = await supabase
      .from("athlete_profiles")
      .select("manual_fields")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readErr) {
      return NextResponse.json(
        { error: "db_read_failed", detail: readErr.message },
        { status: 500 }
      );
    }

    const merged: Record<string, unknown> = {
      ...((existing?.manual_fields ?? {}) as Record<string, unknown>),
    };
    for (const [k, v] of Object.entries(fieldsPatch)) {
      if (v === null) {
        delete merged[k];
      } else {
        merged[k] = v;
      }
    }

    const { error: upsertErr } = await supabase
      .from("athlete_profiles")
      .upsert(
        { user_id: user.id, manual_fields: merged },
        { onConflict: "user_id" }
      );
    if (upsertErr) {
      return NextResponse.json(
        { error: "db_write_failed", detail: upsertErr.message },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
