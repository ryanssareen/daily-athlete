---
date: 2026-05-21
topic: admin-dashboard
---

# Admin Dashboard

## Problem Frame
The solo operator needs lightweight, safe operational tooling for Daily Athlete
(Next.js `apps/web`). The app is pre-launch (first TestFlight cycle), so v1
prioritizes what's useful now — backup visibility/safety and read-only user
visibility — and defers capabilities that target a user base that doesn't exist yet
or that reinvent platform features. The dashboard is security-sensitive (cross-user
reads, destructive backup ops) and sits against `AGENTS.md`'s RLS/service-role
posture.

> Re-scoped 2026-05-21 after a 7-persona document review found the original spec
> over-scoped for a pre-launch solo operator with three hard feasibility blockers.
> The ambitious original items are preserved under "Deferred (post-v1)".

## Requirements

**Access**
- R1. Shared-password gate enforced **server-side on every admin page AND `/api`
  route** (middleware + per-route session check), constant-time compare, a server
  session (httpOnly/Secure/SameSite, idle + absolute expiry), and failure lockout
  beyond rate-limiting. Secret via `config.ts` validator / env, rotatable without a
  deploy.
- R2. Append-only audit log (action, target, timestamp, source) of **every admin
  operation** — reads/views, exports, and destructive actions alike — on a path the
  dashboard's own flows cannot tamper with.

**Backups — wrap the managed platform, don't reinvent**
- R3. Surface Supabase managed backup + PITR status (last good backup, recovery
  window) in the dashboard.
- R4. Trigger an on-demand logical export (single snapshot) to operator-owned object
  storage on the existing **Inngest** runner; list, download, delete, and age-prune
  exports.
- R5. Export artifacts are full-DB + PII-bearing: encrypted at rest, downloaded only
  via short-lived signed URLs (never a public/guessable path); exclude secrets
  (`strava_tokens`) from dumps or explicitly document their handling.
- R6. Restore is a **guarded, documented runbook** (Supabase PITR where available,
  else dump-restore) surfaced in the dashboard with a pre-restore checklist — not an
  in-place "restore" button.
- R7. Export-job failures are surfaced in the dashboard status; a push alert is added
  if/when an alert channel exists.

**User visibility**
- R8. Read-only user list showing Name (`display_name`) + Email, with search +
  pagination. (Service-role cross-user read — explicit filter, minimal columns,
  audited per `AGENTS.md`.)

**Cross-cutting**
- R9. CSRF protection on all state-changing admin requests (export delete/prune).
  Type-to-confirm is a UX guard, not a CSRF control.

## Success Criteria
- Operator signs in (shared password, server-enforced); no admin capability is
  reachable without a valid server session.
- Backups: managed backup/PITR status is visible; an on-demand export runs, lists,
  downloads via signed URL, and prunes; a restore runbook is documented + surfaced.
- Users: operator can search and see each user's name + email.

## Scope Boundaries
- No multi-admin / RBAC (single shared password, solo operator).
- v1 does **not** build: the custom delta-rollup backup engine, user moderation
  (disable/delete/emails), the username column, or the API explorer — all deferred.
- No analytics/metrics, content-moderation queue, or bulk ops.

## Key Decisions
- Wrap Supabase managed backups + PITR + a simple on-demand export, instead of a
  custom delta-rollup engine. (Review consensus: the custom engine reinvents managed
  backups on the safety-critical path, can't run in a 60s Vercel function, and adds
  risk for an "owned artifacts" preference. The export delivers the
  owned/downloadable-backup want at a fraction of the cost.)
- Restore via runbook, not an in-place button (blast-radius + plan feasibility).
- Shared password retained (solo operator) but hardened (R1), since it gates
  destructive, cross-user, PII-bearing surfaces.
- Read-only user list by name + email; no username column.
- Moderation + API explorer deferred (premature pre-launch / needs unbuilt email
  infra / duplicates existing tooling + adds attack surface).

## Deferred (post-v1) — revisit when the trigger is met
- **Custom delta-rollup backups** — only if a concrete gap in managed backups/PITR
  is named (off-Supabase portability, longer retention). Must run on Inngest.
- **User moderation** (disable/delete + reason emails + templates) — when there's a
  real user base. Prerequisite: add a transactional email provider (none exists
  today); prefer the existing `deleted_at` soft-delete + grace window over hard
  delete; define the disabled-user experience + appeal path.
- **Username** — only as its own user-facing feature with real product value.
- **API explorer** — if curl / Postman / Supabase Studio prove insufficient; then a
  minimal request panel against a server-side allow-list of non-destructive
  endpoints, operator session only (never service-role), no enumeration/
  classification engine.

## Dependencies / Assumptions
- Dashboard lives in `apps/web` (Next.js); backups orchestrated on the existing
  Inngest runner.
- Operator-owned object storage (Supabase Storage bucket or similar) for exports.
- Supabase managed backups + PITR enabled.

## Outstanding Questions

### Resolve Before Planning
- (none — blockers resolved by the re-scope)

### Deferred to Planning
- [Affects R6] Confirm Supabase PITR / fresh-project restore capability on the
  current plan (decides PITR-based vs. dump-restore runbook).
- [Affects R4,R5] Object-storage choice + signed-URL mechanism + keeping export
  size/time within Inngest step limits.
- [Affects R1] Shared password vs. the `config.ts` validator; durable
  rate-limit/lockout store (serverless in-memory counters don't throttle across
  instances).

## Next Steps
→ `/ce:plan` for structured implementation planning
