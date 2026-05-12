// Athlete profile contracts: derived baselines, manual fields, and the
// per-field manual-edit timestamps. Mirrors `public.athlete_profiles` from
// supabase/migrations/0004_athlete_profiles.sql. See the plan at
// docs/plans/2026-05-12-001-feat-athlete-profile-schema-plan.md for the full
// rationale (R4-R6 from the schema brainstorm).
//
// Inner shape policy in v1:
// - `BaselinesSchema.per_sport` and `target_event` inner content stay loose
//   (passthrough) until product plan Unit 2.3 lands derivation.
// - The `confidence` and `dominant_sport` enums ARE pinned now -- three
//   buckets and the small sport vocabulary are unlikely to churn.
//
// This is the first per-table module under packages/shared/src/. Subsequent
// modules (users, entitlement, strava-token, strava-raw-payload, etc.) should
// follow the same shape: one file per logical table family, exported schema
// named `<Entity>RowSchema`, inferred TS type named `<Entity>Row`, plus the
// per-JSONB-column sub-schemas needed by callers. The pattern is locked
// across already-shipped tables in the Unit 4 follow-up issue.

import { z } from "zod";

// ---------------------------------------------------------------------------
// `baselines` JSONB column (derivation-owned).
// Per R4: per-sport pace/HR/power, dominant sport, confidence.
// ---------------------------------------------------------------------------

export const BaselinesSchema = z
  .object({
    // Per-sport blob. Inner content (zones, units for power vs pace vs HR)
    // converges with the derivation worker in product plan Unit 2.3; until
    // then this is `z.unknown()` keyed by sport.
    per_sport: z.record(z.unknown()).optional(),
    dominant_sport: z.enum(["run", "bike", "swim", "other"]).optional(),
    confidence: z.enum(["low", "med", "high"]).optional(),
  })
  // Leave room for derivation-only fields without forcing a Zod change.
  .passthrough();

export type Baselines = z.infer<typeof BaselinesSchema>;

// ---------------------------------------------------------------------------
// `weekly_volume_ewma` JSONB column (derivation-owned).
//
// `total_min` is a derived SUM of `run_min + bike_min + swim_min` (and any
// future per-sport rolls), written by the derivation worker in the same
// pass. The Zod schema does NOT enforce the invariant -- derivation owns
// it. Stored separately (rather than re-summed on read) so downstream
// callers can sort/threshold against a single field.
// ---------------------------------------------------------------------------

export const WeeklyVolumeEwmaSchema = z
  .object({
    run_min: z.number().optional(),
    bike_min: z.number().optional(),
    swim_min: z.number().optional(),
    total_min: z.number().optional(),
    half_life_days: z.number().optional(),
  })
  .passthrough();

export type WeeklyVolumeEwma = z.infer<typeof WeeklyVolumeEwmaSchema>;

// ---------------------------------------------------------------------------
// `manual_fields` JSONB column (athlete-owned).
// Per R4: age, weight, weekly hours, target event metadata.
// Per R5: derivation MUST NOT write to this column.
// ---------------------------------------------------------------------------

export const ManualFieldsSchema = z
  .object({
    age: z.number().int().nonnegative().optional(),
    weight_kg: z.number().nonnegative().optional(),
    weekly_hours_avail: z.number().nonnegative().optional(),
    // Inner shape stays loose until product plan Unit 2.3 settles event
    // metadata. The athlete edits target_event as a whole blob in v1.
    target_event: z
      .object({
        type: z.string().optional(),
        date: z.string().optional(),
        distance_m: z.number().optional(),
        notes: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ManualFields = z.infer<typeof ManualFieldsSchema>;

// ---------------------------------------------------------------------------
// `manual_field_edited_at` JSONB column (athlete-owned, app-maintained
// alongside `manual_fields`).
//
// Flat map: top-level key of `manual_fields` -> ISO-8601 timestamp at which
// the athlete last edited that field. Nested target-event sub-fields are
// NOT independently tracked in v1 (the athlete edits the whole target_event
// blob, so a single `target_event` key in this map is sufficient).
//
// Lockstep with `manual_fields` is currently an app-layer responsibility.
// Trigger or CHECK-based enforcement is tracked in the Unit 4 follow-up
// issue and must be decided before product plan Unit 2.3 starts derivation.
// ---------------------------------------------------------------------------

export const ManualFieldEditedAtSchema = z.record(z.string().datetime());

export type ManualFieldEditedAt = z.infer<typeof ManualFieldEditedAtSchema>;

// ---------------------------------------------------------------------------
// Full row shape -- matches the table in 0004_athlete_profiles.sql.
// ---------------------------------------------------------------------------

export const AthleteProfileRowSchema = z.object({
  user_id: z.string().uuid(),
  baselines: BaselinesSchema,
  weekly_volume_ewma: WeeklyVolumeEwmaSchema,
  manual_fields: ManualFieldsSchema,
  manual_field_edited_at: ManualFieldEditedAtSchema,
  derived_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type AthleteProfileRow = z.infer<typeof AthleteProfileRowSchema>;
