---
title: "feat: Admin dashboard v1 — access gate, backups, read-only user list"
type: feat
status: completed
date: 2026-05-21
deepened: 2026-05-21
origin: docs/brainstorms/2026-05-21-admin-dashboard-requirements.md
---

# feat: Admin dashboard v1

## Overview
A password-protected operator dashboard in `apps/web` (Next.js 15 App Router) that
provides: a hardened shared-password gate with a server session + audit log;
backup tooling (surface Supabase managed-backup/PITR status, an on-demand encrypted
logical export to private Storage, and a guarded restore runbook); and a read-only
user list. Moderation, custom delta backups, the username column, and the API
explorer are explicitly deferred (see origin doc).

## Problem Frame
Pre-launch solo operator needs safe, visible operational tooling without reaching
for raw SQL/Studio for routine checks, and needs **owned, downloadable backups**
because on the likely current Supabase tier managed backups may not be retained/
restorable on demand. The dashboard concentrates cross-user + destructive,
RLS-bypassing capability, so it is security-sensitive and must respect `AGENTS.md`'s
RLS/service-role posture. (see origin: docs/brainstorms/2026-05-21-admin-dashboard-requirements.md)

## Requirements Trace
- R1. Shared-password gate enforced server-side on every admin page AND `/api/admin`
  route; constant-time compare; server session (httpOnly/Secure/SameSite, idle +
  absolute expiry); failure lockout beyond rate-limiting; secret via `config.ts`.
- R2. Append-only, tamper-resistant audit log of **every** admin operation (reads,
  exports, destructive actions).
- R3. Surface Supabase managed backup + PITR status.
- R4. On-demand logical export to operator-owned object storage on Inngest; list,
  download, delete, age-prune.
- R5. Export artifacts encrypted (app-layer) + downloaded only via short-lived
  signed URLs; secrets excluded/handled.
- R6. Restore = guarded, documented runbook (not an in-place button).
- R7. Export-job failures surfaced in dashboard status.
- R8. Read-only user list (Name + Email) with search + pagination (service-role
  cross-user read, minimal columns, audited).
- R9. CSRF protection on all state-changing admin requests.

## Scope Boundaries
- No multi-admin/RBAC; single shared password.
- Deferred (origin doc): custom delta-rollup backup engine, user moderation
  (disable/delete/emails), username column, API explorer.
- No analytics/metrics, no content-moderation queue, no bulk ops.
- The export is a **logical row export of app tables** (small pre-launch DB), not a
  full-cluster `pg_dump`. Scaling to a `supabase db dump` runner is future work.

## Context & Research

### Relevant Code and Patterns
- **Auth gate (route):** `apps/web/src/auth/server.ts` `createClient`, `apps/web/src/auth/bearer.ts` `resolveAuth`, and the 401/400/403 `NextResponse.json` shape in `apps/web/app/api/coach/workouts/route.ts`.
- **Page/layout gate:** `getUserWithRoles()` + `redirect()` in `apps/web/app/(coach)/layout.tsx` — mirror for an `(admin)` group, but check the **admin session**, not a Supabase role.
- **Constant-time compare + HMAC:** `apps/web/src/security/token-crypto.ts` (`timingSafeEqual`, AES-256-GCM versioned-key `encrypt/decrypt`), `apps/web/src/strava/state-nonce.ts` (HMAC sign/verify, no length early-return).
- **Secret validator:** `apps/web/src/config.ts` `requireProd(v, key, label)` + `validateStateSigningKeyProd` (strict shape). `CRON_SECRET` is read raw from `process.env` and is **not** the pattern to copy for `ADMIN_PASSWORD`.
- **Service-role cross-user read:** `apps/web/src/db/admin.ts` `createAdminClient` + `apps/web/src/db/roster.ts` (`.select("id, email, display_name")`, `// service-role: explicit user filter required`).
- **Inngest function template:** `apps/web/src/inngest/functions/backfill-strava.ts` (`step.run`, `retries`, `onFailure`, **counts/IDs only in step returns — never PII**); register in `apps/web/src/inngest/functions/index.ts` (currently empty). Served at `apps/web/app/api/inngest/route.ts`.
- **Cron:** `apps/web/vercel.json` + `apps/web/app/api/cron/backfill-watchdog/route.ts` (`Authorization: Bearer ${process.env.CRON_SECRET}`).
- **CSRF guard:** `rejectCrossOrigin` (`Sec-Fetch-Site`) in `apps/web/app/api/integrations/strava/backfill/retry/route.ts`.
- **UI convention:** inline `style={{}}` + CSS custom properties (`var(--color-*)` in `app/globals.css`), `lucide-react` icons, list precedent `apps/web/app/(coach)/roster/page.tsx`. **No shadcn/ui** — do not assume primitives.
- **users schema:** `supabase/migrations/0001_users_and_entitlements.sql` (`id, email, display_name, role_flags, timezone, deleted_at`; no `username`).

### Institutional Learnings
- `docs/solutions/strava-oauth.md` — security blueprint: server-signed HMAC (never client-supplied), `timingSafeEqual` no early-return, CI-enforced no-secrets-in-logs policy → model the audit log's emit side on its event-name/success/code shape.
- `docs/solutions/strava-token-crypto.md` — exact `config.ts` validator shape (throw in prod, skip dev/test, reject placeholders) + secret provisioning (0600 file → `vercel env add` → shred). Repo prefers hashed/HMAC tokens over plaintext — store an HMAC-signed session, compare the password constant-time.
- `docs/solutions/migration-conventions.md` — every new user-keyed table needs +/- RLS tests + `delete_user_cascade` update in the same PR (CI-enforced); no `now()`-dependent logic in migrations (schedule in app layer); new tables must NOT join `supabase_realtime` (`packages/shared/src/realtime-allowlist.ts`, CI-enforced).
- `docs/solutions/partial-unique-with-soft-delete.md` — reads must add `deleted_at IS NULL` explicitly; admin cross-user reads are exactly where ghost rows leak.
- `docs/solutions/inngest-setup.md` — Inngest is dormant; `INNGEST_SIGNING_KEY` only *warns* (not throws) in prod — gate the export feature on its presence; unsigned `/api/inngest` is an open trigger.

### External References (Supabase, 2026)
- Managed backups daily retention by tier (Free: not retained for restore; Pro 7d; Team 14d; Enterprise 30d). PITR is a paid add-on (in-place restore only). Status is readable via Management API `GET /v1/projects/{ref}/database/backups`; **no on-demand create-backup API; no programmatic restore-to-fresh-DB** (PITR restore is in-place via `POST .../restore-pitr`).
- `pg_dump` from Vercel/Inngest is **not feasible** (no binary, read-only FS, `/tmp` ~500 MB, time/memory limits). Realistic: a JS/SQL logical export for a small DB, or an out-of-band `supabase db dump` runner (GitHub Actions) that Inngest orchestrates. Dumps need a **session-mode (5432) or direct** connection, never transaction mode (6543).
- Supabase Storage: private bucket + service-role upload + `createSignedUrl(expiry)`; default global size cap (Free 50 MB / Pro+ up to 500 GB) must be raised; resumable (TUS) uploads for large files; AES-256 at rest by default — but a signed URL grants anyone-with-link read, so client-side encrypt dump artifacts.
- Sources: supabase.com/docs/guides/platform/backups, .../manage-your-usage/point-in-time-recovery, reference/api/lists-all-backups, reference/cli/supabase-db-dump, guides/storage/uploads/file-limits, guides/database/connecting-to-postgres.

## Key Technical Decisions
- **Admin session = separate signed cookie, not a Supabase role.** Honors the shared-password decision; reuse `state-nonce.ts` HMAC + `timingSafeEqual`. The Supabase `role_flags` CHECK only allows athlete/coach, so an "admin role" isn't available without a migration — and the operator isn't necessarily a Supabase user. Rationale + precedent: origin doc + strava-oauth.md.
- **`middleware.ts` is a coarse first gate only.** Edge runtime can't run `node:crypto`/service-role, so the authoritative check (verify signed session) lives in a `server-only` util called by the `(admin)` layout and every `/api/admin` route (defense in depth). Mirrors `getUserWithRoles()` reuse.
- **`ADMIN_PASSWORD` + session-signing key + backup-encryption key go through the `config.ts` validator** (`requireProd`/strict), throw-in-prod, skip dev/test. Do not copy `CRON_SECRET`'s raw `process.env` bypass.
- **Backups reframed:** surface managed status via the Management API (read-only); the operator-owned backup is an **app-layer logical export** (per-table → NDJSON, gzip, AES-256-GCM client-side encrypt, upload to a private Storage bucket) orchestrated by the **first live Inngest function**. Counts/IDs only flow through Inngest step returns; artifact bytes/URLs never do. Feasible for a small pre-launch DB; the scale path (GitHub Actions `supabase db dump`) is documented, not built.
- **Admin session is server-backed + revocable, not a self-signed token.** A self-contained HMAC token can't be revoked, so logout couldn't kill a session held elsewhere and rotating `ADMIN_PASSWORD` wouldn't invalidate live sessions. Persist a session row (random id) and have the cookie carry `sessionId.expiry.hmac`; `verifyAdminSession` checks the HMAC AND that the row exists, is unrevoked, and within idle+absolute expiry. (deepened: security review C1)
- **Restore is a runbook, not a button** (no programmatic restore-to-fresh-DB exists). PITR-trigger is out of v1 unless the add-on is confirmed.
- **Audit log immutability is enforced by a DB trigger, not just RLS.** The dashboard writes as the service-role client, which **bypasses RLS** — so "no UPDATE/DELETE policy" only stops anon/user clients (who already can't write). Add a `BEFORE UPDATE OR DELETE` trigger on `admin_audit_log` that `RAISE EXCEPTION`s (triggers fire for service-role too). `target_user_id` is a real FK with `ON DELETE SET NULL` (preserves the trail across user deletes); add an explicit documented exclusion entry in `delete_user_cascade` so CI passes. Audit metadata is non-PII/structured only (action, ids, codes, counts) so the immutable table never becomes an erasure problem. (deepened: data-integrity F1/F4, security M2)
- **Backup-artifact encryption protects against Storage / signed-URL exposure, NOT admin-console compromise.** The `BACKUP_ENCRYPTION_KEYS` live in server config, so anyone with the shared password can both fetch the ciphertext and read the key. v1 accepts this (server-held key); the export is an explicit **allow-list of tables/columns** (it is a full plaintext PII dump of `users.email`, `entitlements`, `strava_raw_payloads`, etc.). State this honestly; a true operator-held key is future work. (deepened: security C3/C4)

## Open Questions

### Resolved During Planning
- *Backup execution runtime?* → App-layer logical export on Inngest (not in-request; not `pg_dump`). (external research)
- *How to surface managed backups?* → Management API `GET .../database/backups` (read-only). (external research)
- *Restore mechanism?* → Documented runbook (PITR in-place only if add-on on; else dump restore). (external research)
- *Artifact storage?* → Private Supabase Storage bucket, service-role upload, short-lived signed-URL download, client-side encrypted. (external research)
- *Admin secret storage?* → `config.ts` validator (`requireProd`), provisioned via 0600-file→`vercel env add`→shred. (strava-token-crypto.md)

### Deferred to Implementation
- Confirm the project's Supabase **tier + whether the PITR add-on is enabled** (decides what R3 status shows + whether an optional guarded PITR-restore trigger is even possible). The plan is tier-robust: status renders "none" gracefully on Free; the export is the owned backup regardless.
- Exact Storage upload path for larger artifacts (standard vs. resumable/TUS) once real DB size is known; raising the bucket size cap.
- Only the exact lockout **tuning numbers** (attempts/window/lockout duration) are deferred — the policy *shape* (per-IP + global backoff + guaranteed operator self-recovery) is decided in Unit 1. Also deferred: whether the durable store is a Postgres table vs. another mechanism.
- Whether managed-backup status needs a Management API token (PAT) in `config.ts`, or is acceptable as a manual operator note if a PAT is undesirable.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Auth gate (every admin surface):
```
request → middleware.ts (coarse: has da2-admin-session cookie? else redirect/401)
        → (admin) layout OR /api/admin route
            → verifyAdminSession(cookie)  [server-only: HMAC verify + expiry, timingSafeEqual]
                 valid   → render / handle, then writeAudit(...)
                 invalid → redirect('/admin/login') / 401
login: POST /api/admin/login → constant-time compare vs config.admin.password
        → on N failures within window: lockout row blocks (durable table)
        → success: set signed httpOnly session cookie (idle+absolute expiry)
```

Backup export pipeline (Inngest, first live function):
```
POST /api/admin/backups/export  (admin-gated, CSRF-checked)
   → inngest.send("admin/backup.export.start")           [returns event id only]
   → fn: step.run("dump")    : SELECT/COPY app tables → NDJSON (per table)
        step.run("package")  : gzip + AES-256-GCM encrypt (versioned key)
        step.run("upload")   : Storage private bucket (service-role)
        step.run("record")   : insert admin_backups row (path, size, status)  [counts/ids only in returns]
        onFailure            : record failed status + dashboard surfacing (R7)
download: GET /api/admin/backups/:id/download → createSignedUrl(path, short expiry)
prune: scheduled (cron/Inngest) → delete artifacts + rows older than retention
```

## Implementation Units

- [x] **Unit 1: Admin access foundation — config secrets, session, lockout, gate, shell**

**Goal:** A working server-enforced shared-password gate with a signed session, failure lockout, and the `(admin)` shell.

**Requirements:** R1, R9 (partial)

**Dependencies:** None

**Files:**
- Modify: `apps/web/src/config.ts` (add `ADMIN_PASSWORD` + `ADMIN_SESSION_SIGNING_KEY` via `requireProd`/strict validators)
- Create: `apps/web/src/auth/admin-session.ts` (sign/verify session cookie, constant-time password compare, lockout check) `import "server-only"`
- Create: `apps/web/app/api/admin/login/route.ts`, `apps/web/app/api/admin/logout/route.ts`
- Create: `apps/web/middleware.ts` (coarse cookie-presence gate for `/admin/:path*`, `/api/admin/:path*`)
- Create: `apps/web/app/(admin)/layout.tsx` (verify session → redirect to `/admin/login`; render the admin nav shell — Backups, Users, Logout), `apps/web/app/(admin)/login/page.tsx`, `apps/web/app/(admin)/page.tsx` (admin landing linking to Backups + Users + a logout affordance)
- Create: `supabase/migrations/0015_admin_sessions_and_login_attempts.sql` (revocable session store + durable lockout store; RLS service-role only; not in realtime allow-list; plain `TIMESTAMPTZ DEFAULT now()` columns — no `now()`-dependent logic/indexes per migration conventions)
- Test: `apps/web/src/auth/__tests__/admin-session.test.ts`, `apps/web/app/api/admin/login/__tests__/route.test.ts`, `apps/web/__tests__/middleware.test.ts`

**Approach:**
- **Reuse the `timingSafeEqual` comparison technique** from `state-nonce.ts` (no length early-return), but NOT its userId-bound token format. The cookie is `sessionId.expiry.hmac` referencing a persisted `admin_sessions` row; `verifyAdminSession` checks HMAC + row exists + unrevoked + idle/absolute expiry. Logout revokes the row; password rotation revokes all rows. (security C1)
- Constant-time compare the submitted password against `config.admin.password`.
- **Lockout keys on Vercel's normalized client IP** — `x-vercel-forwarded-for` (or `request.ip`), set by Vercel at the edge — NOT the raw, client-controllable `x-forwarded-for` chain (on Vercel the *trustworthy* client IP is precisely the Vercel-normalized header, not a separate source). Combine a **per-IP** counter with a **global** backoff that still lets a correct password through after the window — never a permanent global lock (a pure global counter is a self-DoS: anyone could brick the sole operator). Decide the policy *shape* here (per-IP + global backoff + guaranteed self-recovery); only the exact tuning numbers are deferred. Prune old attempt rows. (security C2, data-integrity F6, feasibility P2)
- **Cookie attributes:** `__Host-da2-admin-session`, `HttpOnly; Secure; SameSite=Strict; Path=/`. Do NOT copy the existing `da2-theme` cookie (lax, no Secure/HttpOnly). (security H3)
- **CSRF on the login route too** (it sets the session cookie) — apply the `Sec-Fetch-Site` guard, hardened to **fail closed when the header is absent** for admin routes. (security H2)
- Middleware only checks cookie presence (Edge can't verify HMAC w/ node:crypto nor hit the DB); real verification in `admin-session.ts` from layout + every route. Scope the matcher tightly to `/admin` + `/api/admin`.
- **Admin shell IA:** `(admin)/layout.tsx` renders a minimal persistent nav (Backups, Users, Logout) shared by every admin page, and `(admin)/page.tsx` is the landing that routes the operator into each section — so the dashboard is a navigable whole, not disconnected URLs. (design P1)

**Patterns to follow:** `config.ts` `requireProd`, `state-nonce.ts`, `(coach)/layout.tsx` redirect gate, `strava-oauth.md` security posture.

**Test scenarios:**
- Happy path: correct password → session cookie set; subsequent request with valid cookie passes `verifyAdminSession`.
- Edge: expired (idle and absolute) cookie rejected; tampered/oversized cookie rejected; equal-length-but-wrong signature rejected (timing-safe).
- Error path: wrong password → 401, no cookie; N failures within window → locked out (subsequent correct password still blocked until window passes).
- Integration: middleware redirects an unauthenticated `/admin` page request to `/admin/login`; an `/api/admin/*` route returns 401 without a valid session even if middleware is bypassed.

**Verification:** Visiting any `/admin` route or calling any `/api/admin` route without a valid session is blocked at the server; correct login grants access; lockout triggers after the configured failures.

- [x] **Unit 2: Append-only audit log of all admin operations**

**Goal:** Build the audit *capability* — an immutable table + a `writeAudit` util — and wire it into the routes that exist now (login). Each later unit wires `writeAudit` into its own routes as they're created, so "every admin op is audited" is satisfied incrementally rather than by editing not-yet-existent routes here.

**Requirements:** R2

**Dependencies:** Unit 1

**Files:**
- Create: `supabase/migrations/0016_admin_audit_log.sql` (service-role INSERT only; **`BEFORE UPDATE OR DELETE` trigger that `RAISE EXCEPTION`s** so even the service-role client can't mutate/delete rows — RLS alone is insufficient because service-role bypasses RLS; `target_user_id` a real FK with `ON DELETE SET NULL`; excluded from realtime allow-list)
- Modify: `supabase/migrations/.../delete_user_cascade` — add an explicit documented exclusion entry for `admin_audit_log` (intentionally NOT purged; FK SET NULL preserves the trail) so the CI cascade check passes
- Create: `apps/web/src/db/admin-audit.ts` (`writeAudit({action, target, metadata})`) `import "server-only"`
- Modify: `apps/web/app/api/admin/login/route.ts` to call `writeAudit` (the only admin route that exists at this point; Units 3–5 and 7 each wire `writeAudit` into their own routes — see each unit's criteria)
- Test: `apps/web/src/db/__tests__/admin-audit.test.ts`, `apps/web/src/db/__tests__/realtime-publication.test.ts` (assert table excluded)

**Approach:** Mirror the `logEvent` JSON shape but persist to a table. Metadata is **non-PII / structured only** (action, target id, normalized code, counts) — never emails/names/secrets/cookie/URL values — so the immutable table never becomes a right-to-erasure problem. Timestamp `TIMESTAMPTZ` UTC, source = trusted IP + session id. (security M2, data-integrity F1/F4)

**Patterns to follow:** `logEvent` in `api/coach/workouts/route.ts`; migration conventions; realtime-allowlist exclusion test.

**Test scenarios:**
- Happy path: a destructive op (export delete) writes exactly one audit row with action/target/timestamp/source.
- Edge: a read op (user list view) also writes an audit row (R2 = all ops).
- Error/integrity: an `UPDATE`/`DELETE` attempted **via the service-role client** is rejected by the trigger (this is the threat that matters — not the anon/user path); table is absent from `supabase_realtime`.
- Integration: deleting a user sets `target_user_id` to NULL (FK SET NULL) and leaves the audit row intact; `delete_user_cascade` exclusion entry keeps CI green.

**Verification:** Every admin action produces an immutable audit row; the realtime-publication test passes.

- [x] **Unit 3: Surface managed backup + PITR status**

**Goal:** Show Supabase managed-backup/PITR status in the dashboard (read-only).

**Requirements:** R3

**Dependencies:** Unit 1

**Files:**
- Modify: `apps/web/src/config.ts` (optional `SUPABASE_MANAGEMENT_TOKEN` + project ref)
- Create: `apps/web/src/admin/managed-backups.ts` (call Management API `GET /v1/projects/{ref}/database/backups`)
- Create: `apps/web/app/api/admin/backups/status/route.ts`, `apps/web/app/(admin)/backups/page.tsx` (status section)
- Test: `apps/web/src/admin/__tests__/managed-backups.test.ts` (MSW-mock the Management API)

**Approach:** Read-only fetch; render `pitr_enabled`, latest backup time, retention. Handle Free-tier "no retained backups" gracefully (clear empty state, not an error). If a Management token is undesirable, fall back to a static operator note (deferred).

**Patterns to follow:** MSW test posture; existing fetch + Zod-parse style.

**Test scenarios:**
- Happy path: Management API returns backups → status rendered (latest time, retention, PITR on/off).
- Edge: Free tier / empty `backups[]` → "no managed backups retained" empty state.
- Error path: Management API 401/5xx → graceful error state, audited, no crash.

**Verification:** The backups page shows accurate managed-backup status (or a clean empty/error state) without exposing the token.

- [x] **Unit 4: On-demand encrypted logical export (first live Inngest function)**

**Goal:** Produce an owned, encrypted backup artifact in private Storage.

**Requirements:** R4, R5, R7

**Dependencies:** Unit 1, Unit 2

**Files:**
- Modify: `apps/web/src/config.ts` (add `BACKUP_ENCRYPTION_KEYS` versioned-hex; Storage bucket name) + `apps/web/src/inngest/functions/index.ts` (register the new function)
- Create: `apps/web/src/inngest/functions/admin-backup-export.ts`, `apps/web/src/admin/backup-export.ts` (per-table SELECT/COPY → NDJSON, gzip, AES-256-GCM encrypt, Storage upload, metadata insert)
- Create: `supabase/migrations/0017_admin_backups.sql` (artifact metadata: id, path, size, status, created_at; service-role only; not in realtime allow-list)
- Create: `apps/web/app/api/admin/backups/export/route.ts` (gated + CSRF; emits Inngest event)
- Test: `apps/web/src/admin/__tests__/backup-export.test.ts`, `apps/web/src/inngest/functions/__tests__/admin-backup-export.test.ts`

**Approach:** Reuse `token-crypto.ts` AES-256-GCM versioned keys for client-side artifact encryption.
- **Explicit allow-list of exported tables/columns** (not a deny-list-of-one). The artifact is a full plaintext PII dump (`users.email`, `entitlements`, `strava_raw_payloads`, …) — enumerate it so the PII surface is a conscious decision and future tables don't silently join. Note `strava_tokens` exclusion makes restore lossy (Strava linkage) — either include the already-encrypted token blobs (with key-version) or document the loss in the runbook. (security C4)
- **Atomicity:** `record(pending) → upload → record(success|failed)`. Insert the metadata row FIRST (status `pending`) so an upload that succeeds before the function dies is never an untracked orphan (an untracked artifact = an invisible, never-pruned full-DB copy). Use a **deterministic artifact path from the row id** (`backups/{id}.ndjson.gz.enc`) so row↔object are always linkable. Upload step must be **idempotent (overwrite-on-retry)**. (data-integrity F2/F8)
- **Cross-table consistency:** per-table reads across separate `step.run`s are NOT a single snapshot — and supabase-js/PostgREST **cannot** hold a multi-statement `REPEATABLE READ` transaction across reads (no pg session/driver), so a client-side "one transaction" snapshot is not buildable as previously assumed. Two real options: (a) a `SECURITY DEFINER` Postgres RPC that returns a consistent multi-table snapshot in a single server-side call, or (b) accept a **best-effort** export and make restore FK-order-tolerant (children re-pointed or skipped if a parent shifted mid-read). v1 picks (b) for the small pre-launch DB and documents it as best-effort in the runbook. (data-integrity F7, feasibility P1)
- **Read whole tables, not PostgREST's default page:** supabase-js reads cap at the PostgREST `max-rows` limit, so a naive `.select()` silently truncates a large table into a *partial* backup. Loop `.range(offset, offset+chunk-1)` per table until exhausted (or use the RPC above). (feasibility P2)
- `step.run` returns **counts/IDs only** via a typed `{table, count}` contract — structurally unable to carry rows/URLs/paths-with-PII (Inngest stores returns unencrypted). `onFailure` records a failed row for R7. (security M1)
- The **trigger route gates `verifyAdminSession` BEFORE `inngest.send`** (middleware can't authenticate), **calls `writeAudit`** (export-requested), and adds a "one running export at a time" / idempotency guard so it can't be spammed into a cost/DoS vector. (security H1)

**Execution note:** First live Inngest function — `inngest.send` needs **`INNGEST_EVENT_KEY`** and serving/verifying `/api/inngest` needs **`INNGEST_SIGNING_KEY`**. Promote BOTH from `config.ts` warnings to `requireProd` **errors**, and the trigger route must refuse to send if either is unset (an unsigned live `/api/inngest` is an open trigger; a missing event key makes the trigger silently no-op). (security H5, feasibility P1)

**Patterns to follow:** `inngest/functions/backfill-strava.ts` (steps, retries, onFailure, counts-only returns), `token-crypto.ts`, service-role write convention.

**Test scenarios:**
- Happy path: trigger → function exports tables → encrypted artifact uploaded → `admin_backups` row `status=success` with path+size.
- Edge: empty tables export cleanly; large-ish artifact uses the chosen upload path.
- Error path: upload failure / encryption error → `onFailure` records `status=failed`; no partial success row marked complete.
- Integration: step returns contain no PII or signed URLs (assert); `strava_tokens` excluded from the artifact.
- Round-trip (restorability gate): export → decrypt → load the NDJSON into a scratch schema and assert row counts + sampled key rows match source. A backup that's produced but never restored isn't proven to be a backup. (adversarial P1)

**Verification:** An operator-triggered export yields a downloadable, decryptable, complete artifact, and failures are recorded as failed.

- [x] **Unit 5: Backup list / signed-URL download / delete / age-prune**

**Goal:** Manage export artifacts from the dashboard.

**Requirements:** R4, R5, R9

**Dependencies:** Unit 4

**Files:**
- Create: `apps/web/app/api/admin/backups/[id]/download/route.ts` (createSignedUrl, short expiry), `apps/web/app/api/admin/backups/[id]/route.ts` (DELETE artifact + row), `apps/web/src/admin/backup-retention.ts` (prune > retention)
- Modify: `apps/web/app/(admin)/backups/page.tsx` (list + actions), `apps/web/vercel.json` (prune cron) OR an Inngest scheduled function
- Test: `apps/web/app/api/admin/backups/__tests__/download.test.ts`, `apps/web/src/admin/__tests__/backup-retention.test.ts`

**Approach:** Download: prefer **streaming the (encrypted) bytes through the admin route** so the capability never leaves the authenticated session; if using `createSignedUrl` instead, use a very short TTL (≤60s) and audit URL issuance (the moment the capability escapes). The decryption key is server-held — see Key Decisions (encryption guards Storage/URL exposure, not admin compromise). (security C3/H4)
- **Delete/prune are two-step (object + row) across systems with no transaction.** Rather than a separate `deleting` reconcile state, rely on the deterministic `backups/{id}…` path + the orphan sweep below: delete the Storage object (treat 404 as success → idempotent), then delete the row; if either half fails, the orphan sweep reconciles it on the next run. (data-integrity F3, consolidated)
- **Orphan sweep** in the prune job: list bucket objects, left-join rows, delete objects with no live row past a grace window and flag rows whose object is missing — closes the F2 untracked-artifact leak from either path.
- Prune is scheduled (reuse `CRON_SECRET` bearer pattern if cron-based); no `now()` logic in migrations. All state-changing routes call the hardened `rejectCrossOrigin` (R9).
- **List status + async progress:** render each artifact's `pending`/`running`/`success`/`failed` status and re-fetch (or poll) so an in-flight export visibly resolves; surface R7 failures inline. Handle loading, empty ("no exports yet"), and error states. (design P1)
- **Destructive-action UX:** delete requires an explicit type-to-confirm and reports success/failure — never a silent delete. (Type-to-confirm is a UX guard, not the CSRF control.) (design P1)

**Patterns to follow:** `rejectCrossOrigin` (Sec-Fetch-Site), cron auth in `backfill-watchdog/route.ts`.

**Test scenarios:**
- Happy path: list shows exports; download returns a short-expiry signed URL; delete removes object+row.
- Edge: download of a missing artifact → 404; prune removes only rows older than retention.
- Error path: cross-origin POST to delete/prune → 403 (CSRF guard); delete with Storage failure leaves a consistent state (row kept, error surfaced).
- Integration: each action writes an audit row.

**Verification:** Operator can list, download (signed, expiring), delete, and auto-prune exports; cross-site requests are rejected.

- [x] **Unit 6: Guarded restore runbook**

**Goal:** A documented, guard-railed restore path surfaced in the dashboard.

**Requirements:** R6

**Dependencies:** Unit 3

**Files:**
- Create: `docs/operational/backup-restore-runbook.md` (PITR-via-Management-API steps if add-on on; else dump-restore via CLI/`psql`; pre-restore checklist + safety snapshot step)
- Modify: `apps/web/app/(admin)/backups/page.tsx` (restore section: render the runbook + checklist; no in-place button)
- Test: n/a (documentation + static render); add a render test only if the section has logic

**Approach:** No automated in-place restore (none exists generically). If PITR add-on is confirmed (deferred), a future guarded `restore-pitr` trigger (type-to-confirm) can be added; v1 surfaces the runbook only.

**Patterns to follow:** `docs/operational/*` runbook style; origin doc R6.

**Test scenarios:**
- Happy path: restore section renders the current runbook + checklist.
- Edge: clearly states the path differs by tier (PITR vs dump restore).
- Integration: the dump-restore steps here stay in sync with Unit 4's export→restore round-trip test (that test exercises this path).

**Verification:** An operator can follow a complete, correct restore procedure from the dashboard without guessing.

- [x] **Unit 7: Read-only user list (search + pagination)**

**Goal:** Cross-user, read-only visibility of name + email.

**Requirements:** R8, R2

**Dependencies:** Unit 1, Unit 2

**Files:**
- Create: `apps/web/src/db/admin-users.ts` (service-role read; `select("id, display_name, email")`; `deleted_at IS NULL`; `ilike` search; `range` pagination) `import "server-only"`
- Create: `apps/web/app/(admin)/users/page.tsx` (table + search + pagination), `apps/web/app/api/admin/users/route.ts`
- Test: `apps/web/src/db/__tests__/admin-users.test.ts`

**Approach:** Deliberate RLS-bypass exception — gate behind the admin session *before* `createAdminClient`, select minimal columns, add `// service-role: explicit user filter required (admin-gated cross-user read)` and `deleted_at IS NULL`. Search via `ilike` on display_name/email (parameterized via the supabase-js builder — no raw string concat). Apply `deleted_at IS NULL` to **both the page query AND the total count** (else inflated totals + empty trailing pages of ghost rows). Use a **stable `ORDER BY` (e.g. `created_at, id`)** so offset `range()` pagination doesn't duplicate/skip rows across pages. **Clamp page size server-side** (e.g. max 100) so a crafted large `pageSize` can't pull the whole PII set in one read. Audit each view (R2). (data-integrity F5, security M3)

**Patterns to follow:** `db/roster.ts` (minimal columns + comment), `(coach)/roster/page.tsx` (list UI, adapt to table + search + pagination), partial-unique-with-soft-delete (`deleted_at IS NULL`).

**Test scenarios:**
- Happy path: returns name + email for a page of users; search filters by name/email substring.
- Edge: empty result / last page; soft-deleted users excluded by default.
- Error path: unauthenticated request blocked before any DB read.
- Integration: a list view writes an audit row; query selects only id/display_name/email (no role_flags/tokens).

**Verification:** Operator can find and view users by name/email with working search + pagination; deleted users are hidden; access is audited.

## System-Wide Impact
- **Interaction graph:** new `middleware.ts` runs on `/admin` + `/api/admin` only (scope the matcher tightly so it never touches existing athlete/coach routes). New first live Inngest function changes the (empty) registry — verify existing `after()`-based backfill is unaffected.
- **Error propagation:** admin routes return normalized `{error}` JSON (mirror existing); export failures travel via Inngest `onFailure` → `admin_backups.status=failed` → dashboard (R7).
- **State lifecycle risks:** partial export (uploaded artifact but no metadata row, or vice versa) — order writes so a failure never marks success; prune deletes object before/with row atomically enough to avoid orphans.
- **API surface parity:** all new state-changing `/api/admin/*` routes must carry the CSRF guard + audit + session check uniformly.
- **Integration coverage:** session enforcement at the route layer (not just middleware/page); Inngest step returns contain no PII; realtime-allowlist exclusion for the 3 new tables (CI).
- **UI states (every admin view):** each page handles loading, empty, and error states explicitly; the async export additionally surfaces in-flight progress, and destructive actions confirm + report their outcome. (design P1)
- **Unchanged invariants:** existing athlete/coach RLS, auth, and routes are untouched; the admin surface is additive and isolated under `(admin)`/`/api/admin`.

## Risks & Dependencies
| Risk | Mitigation |
|------|------------|
| Logical export grows beyond serverless/Inngest limits as the DB grows | v1 scoped to a small pre-launch DB; documented scale path = out-of-band `supabase db dump` runner (GitHub Actions) Inngest orchestrates |
| Shared password leak (no per-admin identity) | constant-time compare, lockout, short session expiry, rotatable secret, audit log, never logged |
| Backup artifact = full data; signed URL leak | private bucket + client-side AES-256-GCM encryption (key not in the URL) + short expiry; exclude `strava_tokens` |
| Middleware can't truly authenticate (Edge) | authoritative check in `server-only` util on layout + every route (middleware is coarse only) |
| Inngest dormant / keys only warn | gate export on **both** `INNGEST_EVENT_KEY` (to send) and `INNGEST_SIGNING_KEY` (to serve/verify) being set — promote both to `requireProd`; register function explicitly |
| New tables leaking via realtime | exclusion + CI realtime-publication test |
| Restore expectation mismatch (no auto restore-to-fresh) | runbook, not a button; tier/PITR confirmation deferred |
| Audit log forgeable/erasable by service-role (RLS doesn't bind it) | `BEFORE UPDATE/DELETE` trigger that raises (fires for service-role); test against the service-role client |
| Deleted-user PII persists in backup artifacts (right-to-erasure) | bounded retention/prune is the compliance backstop (state a concrete max); document in runbook + Risks; audit metadata kept non-PII |
| Export trigger spammed → cost/DoS (expensive full dumps) | session-gate before send + one-running-export/idempotency guard |
| Backup artifact never proven restorable | export→restore round-trip test (Unit 4) is the gate; keep the runbook's dump-restore steps in sync with it |

## Documentation / Operational Notes
- Provision `ADMIN_PASSWORD`, signing key, backup-encryption key, and (optional) Management token via 0600-file → `vercel env add` → shred; never inline (AGENTS.md Secrets).
- Raise the Storage bucket global size cap before first export; create the private bucket.
- Confirm Supabase tier + PITR add-on; document in the runbook which restore path applies.
- Update `apps/web/.env.example` with the new (non-secret-valued) keys.

## Sources & References
- **Origin document:** [docs/brainstorms/2026-05-21-admin-dashboard-requirements.md](../brainstorms/2026-05-21-admin-dashboard-requirements.md)
- Related issue: #83
- Code: `apps/web/src/auth/*`, `apps/web/src/config.ts`, `apps/web/src/db/{admin,roster}.ts`, `apps/web/src/inngest/functions/backfill-strava.ts`, `apps/web/src/security/token-crypto.ts`, `apps/web/app/api/integrations/strava/backfill/retry/route.ts`
- Learnings: `docs/solutions/{strava-oauth,strava-token-crypto,inngest-setup,migration-conventions,partial-unique-with-soft-delete}.md`
- External: Supabase backups/PITR/Storage/Management API + Vercel runtime docs (URLs in Context & Research)
