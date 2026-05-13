// Cross-app type contracts. Hand-authored TypeScript types and Zod schemas
// shared between apps/web (UI + API route handlers) and apps/mobile.
// One file per logical table family; this barrel re-exports them.
//
// There is no codegen step. Types are written by hand and reviewed against
// supabase/migrations/*.sql; the schema is the source of truth.

export * from "./athlete-profile";
export * from "./entitlement";
export * from "./plan";
export * from "./planned-workout";
export * from "./realtime-allowlist";
export * from "./strava-raw-payload";
export * from "./strava-token";
export * from "./users";
