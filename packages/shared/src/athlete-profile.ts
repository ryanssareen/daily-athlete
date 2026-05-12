// Hand-authored Zod schemas + TS types for `public.athlete_profiles`.
// Source of truth: supabase/migrations/0004_athlete_profiles.sql.
//
// JSONB column shapes are intentionally permissive in v1 — the brainstorm
// defers the precise per-sport baseline schema to prompt iteration. We model
// the keys we know we'll touch and leave the rest open via `passthrough()`.

import { z } from "zod";

export const sportSchema = z.enum([
    "swim",
    "bike",
    "run",
    "strength",
    "mobility",
    "other",
]);
export type Sport = z.infer<typeof sportSchema>;

// One sport's worth of derived baseline numbers. All fields optional —
// derivation may have only HR for a new runner, only power for a cyclist, etc.
// `confidence` is a 0..1 flag the derivation job sets when the sample is thin.
export const sportBaselineSchema = z
    .object({
        threshold_pace_s_per_km: z.number().positive().optional(),
        threshold_hr_bpm: z.number().int().positive().optional(),
        threshold_power_w: z.number().positive().optional(),
        zones: z.array(z.number()).optional(),
        confidence: z.number().min(0).max(1).optional(),
    })
    .passthrough();
export type SportBaseline = z.infer<typeof sportBaselineSchema>;

export const baselinesSchema = z.record(sportSchema, sportBaselineSchema);
export type Baselines = z.infer<typeof baselinesSchema>;

// Manual fields the athlete edits directly. Each may be unset.
export const manualFieldsSchema = z
    .object({
        age: z.number().int().min(0).max(120).optional(),
        weight_kg: z.number().positive().optional(),
        weekly_hours_available: z.number().min(0).optional(),
        target_event: z
            .object({
                name: z.string().optional(),
                date: z.string().date().optional(),
                distance_m: z.number().positive().optional(),
                sport: sportSchema.optional(),
            })
            .partial()
            .passthrough()
            .optional(),
    })
    .passthrough();
export type ManualFields = z.infer<typeof manualFieldsSchema>;

// Mirror of manualFieldsSchema's keys, each value an ISO timestamp marking
// when that field was last manually edited. Used by the derivation job to
// decide whether a fresher manual value supersedes a stale derived one.
export const manualFieldEditedAtSchema = z
    .object({
        age: z.string().datetime().optional(),
        weight_kg: z.string().datetime().optional(),
        weekly_hours_available: z.string().datetime().optional(),
        target_event: z.string().datetime().optional(),
    })
    .passthrough();
export type ManualFieldEditedAt = z.infer<typeof manualFieldEditedAtSchema>;

// Exponentially-weighted weekly volume by sport. Shape converges with the
// derivation job in product plan Unit 2.3; keep loose for now.
export const weeklyVolumeEwmaSchema = z.record(sportSchema, z.number());
export type WeeklyVolumeEwma = z.infer<typeof weeklyVolumeEwmaSchema>;

// Full row as returned by Postgres (timestamps are ISO strings over the wire).
export const athleteProfileSchema = z.object({
    user_id: z.string().uuid(),
    baselines: baselinesSchema,
    manual_fields: manualFieldsSchema,
    manual_field_edited_at: manualFieldEditedAtSchema,
    weekly_volume_ewma: weeklyVolumeEwmaSchema,
    derived_at: z.string().datetime().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
});
export type AthleteProfile = z.infer<typeof athleteProfileSchema>;

// Shape accepted at the API boundary when the athlete edits manual fields.
// `manual_field_edited_at` is stamped server-side per field, not by the client.
export const athleteProfileManualFieldsUpdateSchema = manualFieldsSchema;
export type AthleteProfileManualFieldsUpdate = z.infer<
    typeof athleteProfileManualFieldsUpdateSchema
>;
