---
date: 2026-05-22
topic: admin-user-moderation
brainstorm: docs/brainstorms/2026-05-21-admin-dashboard-requirements.md
status: implemented
---

# feat: Admin user moderation (disable + soft-delete)

## Overview

Add operator-driven user moderation to the existing admin dashboard (`apps/web`):
**disable / re-enable** an account (blocked login) and **soft-delete / restore**
an account (30-day grace window). This was the explicitly deferred "User
moderation" item from the v1 admin-dashboard brainstorm; we build it now with its
three prerequisites satisfied (a transactional email provider, soft-delete-first,
defined disabled-user experience + appeal path).

Every action reuses the established admin posture: the `requireAdmin` session gate,
the `Sec-Fetch-Site` CSRF guard, `writeAudit` with **non-PII** metadata, and
service-role writes carrying an explicit `user_id` filter. Type-to-confirm is added
on destructive actions as a UX guard (not the CSRF control).

## Problem Frame

The brainstorm deferred moderation with named blockers; each is now resolved:

> **User moderation** (disable/delete + reason emails + templates) — when there's a
> real user base. Prerequisite: add a transactional email provider (none exists
> today); prefer the existing `deleted_at` soft-delete + grace window over hard
> delete; define the disabled-user experience + appeal path.

Resolutions (operator decisions, 2026-05-22):
- **Email provider:** Brevo (transactional REST API). Reason emails are sent on
  disable + delete. Sender = operator email (verified in Brevo).
- **Delete model:** soft-delete (`deleted_at`) + **30-day grace** + Restore.
  Permanent purge (`delete_user_cascade` + `auth.admin.deleteUser`) is deferred to
  a follow-up sweeper.
- **Disabled experience:** **blocked login** via Supabase Auth ban
  (`auth.admin.updateUserById(..., { ban_duration })`). Appeal path = the reason
  email (reply-to operator) explains status + how to appeal.

## Requirements Trace

| # | Requirement | Source | Unit |
|---|---|---|---|
| M1 | Disable an account → blocked login; re-enable reverses it | brainstorm "User moderation" | 2,3,4 |
| M2 | Soft-delete an account → drops from directory + blocked login; 30-day grace; Restore | brainstorm (prefer `deleted_at` + grace) | 1,3,4 |
| M3 | Reason email to the affected user on disable + delete (Brevo) | brainstorm (transactional email prereq) | 2 |
| M4 | Defined disabled-user experience + appeal path | brainstorm (define before coding) | (this doc) + 2 |
| M5 | Every action through `writeAudit` with **non-PII** metadata | brainstorm R2 + admin-audit.ts | 4 |
| M6 | Admin session gate + `Sec-Fetch-Site` CSRF on every mutation | brainstorm R1/R9 | 4 |
| M7 | Service-role writes carry an explicit `user_id` filter | AGENTS.md RLS posture | 3 |
| M8 | Type-to-confirm on destructive actions (UX guard, not CSRF) | brainstorm R9 note | 5 |
| M9 | Surface actions on the existing read-only users table | task | 5 |

## Scope Boundaries

**In scope:** disable/enable, soft-delete/restore, Brevo reason emails, the four
moderation API actions, directory status badges + a "Deleted (in grace)" view + row
actions with type-to-confirm, audit + tests.

**Out of scope (documented follow-ups):**
- **Permanent purge sweeper** — a scheduled Inngest job that, after the grace
  window, calls `delete_user_cascade` then `auth.admin.deleteUser`. This PR leaves
  `deleted_at` tombstones + a `purgeEligibleAt` helper; no row is hard-deleted here.
- **Client-side banned-state messaging** — mobile/web sign-in screens showing a
  friendly "account disabled — see your email / contact support" instead of the
  generic GoTrue error. The appeal path is delivered proactively by email in this
  PR; in-app polish is a cross-app follow-up.
- Bulk moderation, RBAC/multi-admin, content moderation queue, username column.

## Context & Research

### Relevant code and patterns (verified)

- **Audit:** `apps/web/src/db/admin-audit.ts` — `writeAudit({action, targetUserId,
  target, metadata, ip, sessionId})`; never throws; **metadata must be non-PII**.
- **Gate + CSRF:** `apps/web/src/auth/admin-guard.ts` (`requireAdmin`),
  `apps/web/src/auth/admin-session.ts` (`isSameOriginRequest` fails closed on
  absent `Sec-Fetch-Site`; `clientIp`).
- **Destructive-mutation route shape:** `apps/web/app/api/admin/backups/[id]/route.ts`
  — CSRF → gate → service-role op (explicit filter) → `writeAudit`. Mirror this.
- **Service-role client:** `apps/web/src/db/admin.ts` (`createAdminClient()`); has
  the service-role key, so `admin.auth.admin.*` (ban/unban) is available.
- **Directory read:** `apps/web/src/db/admin-users.ts` (`listUsers`) already filters
  `deleted_at IS NULL`, clamps page size, sanitizes search; `GET
  /api/admin/users/route.ts` audits views with non-PII metadata.
- **Directory UI:** `apps/web/app/admin/(authed)/users/_components/users-table.tsx`
  (client; debounced search, abortable, last-wins) + `users/page.tsx`.
- **Soft-delete + cascade:** `users.deleted_at` exists (0001). `delete_user_cascade(uuid)`
  (0010, re-declared 0016) soft-archives `coach_athlete_links` only; **true identity
  deletion is `auth.admin.deleteUser(id)`** (FK `ON DELETE CASCADE` `auth.users →
  public.users`). Test teardown across the repo uses exactly this pair.
- **Config validator:** `apps/web/src/config.ts` — every new sensitive setting
  extends it (`requireProd` / a strict `validate*Prod`). `STRAVA_WEBHOOK_SUBSCRIPTION_ID`
  is precedent for **warn-not-fatal** when a feature should degrade (no email)
  rather than brick boot.
- **Shared types:** `packages/shared/src/users.ts` (`UserRowSchema`) — hand-authored
  mirror of the SQL row; barrel-exported. New input schemas live here per AGENTS.md.
- **Route test to mirror:** `apps/web/app/api/admin/login/__tests__/route.test.ts`
  (vitest; mocks DB-touching deps, keeps `isSameOriginRequest` real; covers CSRF /
  absent-header / auth / parse / happy paths). Latest migration: `0017`.

### External references

- Brevo transactional email: `POST https://api.brevo.com/v3/smtp/email`, header
  `api-key: <key>`, JSON `{ sender:{email,name}, to:[{email}], subject, htmlContent }`.
  Plain `fetch` — **no new npm dependency**. Sender must be a verified sender/domain
  in Brevo.
- Supabase GoTrue ban: `auth.admin.updateUserById(uid, { ban_duration: "876000h" })`
  blocks sign-in + token refresh; `{ ban_duration: "none" }` unbans. Existing access
  tokens remain valid until natural expiry (~1h) — documented lag, acceptable for
  moderation.

## Key Technical Decisions

1. **Blocked login via Auth ban, not RLS read-only.** One service-role admin call
   enforces across web + mobile + API with no per-table policy retrofit. (M1, M4)
2. **Soft-delete reuses `deleted_at`; grace = `deleted_at + 30d`.** No new "scheduled"
   column. Restore = clear `deleted_at` + unban. Purge eligibility is a pure helper
   for the deferred sweeper. (M2)
3. **Single moderation route with a discriminated action.** `POST
   /api/admin/users/[id]/moderation` `{ action, reasonCode, reason? }` — one
   CSRF/gate/audit path, one comprehensive test file. (M5, M6)
4. **Reason split: code persists, free-text is email-only.** A normalized
   `reasonCode` enum goes to the row + audit (non-PII); the operator's free-text
   `reason` goes **only** into the email body, never the DB/audit. (M3, M5)
5. **Email is best-effort + degrades gracefully.** Send happens after the state
   change; a failed/!configured send never fails the moderation action (audited as
   `emailed:false`). `BREVO_API_KEY`/`EMAIL_SENDER` validated when present, **warn**
   (not fatal) when absent in prod — moderation still works, emails are disabled. (M3)
6. **Disable + soft-delete both ban; enable + restore both unban.** A soft-deleted
   account must not be loginable during grace. (M1, M2)

## Open Questions

### Resolved during planning
- Email provider → **Brevo** (operator decision).
- Disabled experience → **blocked login (Auth ban)**; appeal via reason email.
- Delete depth → **soft + 30-day grace + restore**; purge deferred.

### Deferred to implementation
- **Sender email address** — operator said "my email"; confirm `ryansareen6@gmail.com`
  vs the `ryanssareen@gmail.com` Google account, and complete Brevo sender
  verification. (Setup unit.)
- **Reason-code vocabulary** — proposed: `spam`, `abuse`, `tos_violation`, `fraud`,
  `user_request`, `other`. Adjust during Unit 1 if the operator prefers different
  buckets.
- **Grace window length** — defaulted to **30 days** (`MODERATION_GRACE_DAYS`).

## Disabled / deleted user experience + appeal path (M4 — define before coding)

| State | Login | In directory | Data | Reverse | What the user gets |
|---|---|---|---|---|---|
| **Active** | ✅ | ✅ (badge: Active) | intact | — | — |
| **Disabled** | ❌ banned | ✅ (badge: Disabled) | intact, hidden behind ban | **Enable** | Reason email: disabled + reason + "reply to appeal" |
| **Soft-deleted** | ❌ banned | hidden (in "Deleted (in grace)" view, shows days left) | intact until purge | **Restore** ≤30d | Reason email: scheduled for deletion + grace + appeal |
| **Purged** (deferred) | ❌ | gone | cascade-removed | irreversible | (final email — sweeper PR) |

**Appeal path:** proactive reason email with reply-to = operator (the support
contact). Users with no email on file can't be notified — surfaced as `emailed:false`
in the audit; in-app banned-state messaging is the documented follow-up. The ~1h
access-token lag after a ban is documented operational behavior.

## High-Level Technical Design

> *Directional guidance for review, not implementation spec.*

```
POST /api/admin/users/[id]/moderation  { action, reasonCode, reason? }
  → isSameOriginRequest(headers)         else 403   (CSRF, fail-closed)
  → requireAdmin(request)                else 401
  → UserModerationRequestSchema.parse    else 400 ; id must be uuid
  → dispatch (admin-moderation.ts, service-role, explicit user_id filter):
       disable : users.disabled_at=now(), disabled_reason_code=code ; ban
       enable  : users.disabled_at=null,  disabled_reason_code=null ; unban
       delete  : users.deleted_at=now(),  disabled_reason_code=code ; ban   (soft)
       restore : users.deleted_at=null (only if within grace) ; unban
     → {ok} | {not_found:404} | {conflict:409}    (bad state, e.g. restore a live user)
  → notifyUser (Brevo, best-effort)      on disable|delete ; never fatal
  → writeAudit  action=admin.users.<action>, targetUserId=id,
                metadata={ reasonCode, emailed }   (NON-PII: no email, no free-text)
  → 200 { ok:true, emailed }
```

## Implementation Units

- [x] **Setup: Brevo API key + env wiring** *(side-effecting; do at top of implementation)*

**Goal:** A working Brevo transactional key in dev env, a verified sender, and the
config surface — without ever committing the secret.

**Steps:**
- Via **Claude in Chrome** (operator authorized; Google account
  `ryanssareen@gmail.com` already logged in): open Brevo → Settings → SMTP & API →
  API Keys → create/copy a transactional key. Confirm/verify the **sender email**.
- Write `BREVO_API_KEY` + `EMAIL_SENDER` to `apps/web/.env.local` (gitignored;
  confirmed `.env*.local` is ignored). **Never** commit the key or echo it into a
  doc/shell history (AGENTS.md "Secrets").
- Add placeholders to `apps/web/.env.example`; add both keys to `config.ts`.
- Operator adds the same two vars to Vercel prod env (guide, don't automate).

**Files:** modify `apps/web/.env.example`, `apps/web/src/config.ts` (warn-not-fatal
validators), create `apps/web/.env.local` (untracked).

**Verification:** `config.email.brevoApiKey` resolves in dev; absence → a single
warning, app still boots.

- [x] **Unit 1: Schema + shared types — moderation state**

**Goal:** Persist disabled state; keep the shared row contract in sync.

**Requirements:** M2 (deleted_at reuse), supports M1

**Dependencies:** None

**Files:**
- Create `supabase/migrations/0018_user_moderation.sql`:
  - `ALTER TABLE public.users ADD COLUMN disabled_at TIMESTAMPTZ`,
    `ADD COLUMN disabled_reason_code TEXT`.
  - Partial index `users_disabled_at_idx ON users(disabled_at) WHERE disabled_at IS
    NOT NULL` (mirrors `users_deleted_at_idx`).
  - **No** `delete_user_cascade` change (no new table; purge is deferred). **No** RLS
    policy change — enforcement is Auth ban, not RLS; users table keeps its existing
    policies + pos/neg RLS tests. **Not** added to `supabase_realtime`.
- Modify `packages/shared/src/users.ts`: add `disabled_at` (nullable tz),
  `disabled_reason_code` (nullable) to `UserRowSchema`; add
  `ModerationReasonCodeSchema = z.enum([...])`.
- Test: `packages/shared/src/__tests__/users.test.ts` (new columns parse;
  reason-code enum).

**Approach:** Follow 0001's column + partial-index conventions; plain `TIMESTAMPTZ`.

**Verification:** migration applies; shared types compile; row round-trips.

- [x] **Unit 2: Brevo email module + notify seam**

**Goal:** A small, dependency-free Brevo client + templated moderation emails that
fail soft.

**Requirements:** M3, M4 (appeal text)

**Dependencies:** Setup

**Files:**
- Modify `apps/web/src/config.ts`: `config.email = { brevoApiKey, sender }`;
  `validateBrevoProd` = **warn** when absent (email disabled), validate format when
  present.
- Create `apps/web/src/email/brevo.ts` (`import "server-only"`):
  `sendTransactionalEmail({to, subject, html})` via `fetch` to Brevo; returns
  `{ sent, reason? }`, never throws; returns `{sent:false, reason:"unconfigured"}`
  when no key.
- Create `apps/web/src/email/moderation-emails.ts`: `notifyModeration({to, action,
  reasonCode, reason})` → builds subject/body per action (includes appeal/reply-to);
  returns `{sent}`. Maps `reasonCode` → human sentence; appends free-text `reason`.
- Test: `apps/web/src/email/__tests__/brevo.test.ts`,
  `.../moderation-emails.test.ts` (mock `fetch`): correct payload + headers;
  unconfigured → `sent:false`; non-2xx → `sent:false` (no throw); free-text reason
  appears in body only.

**Approach:** Reason email = the appeal channel; reply-to/sender = operator.

**Verification:** unit tests green; no new dependency added.

- [x] **Unit 3: Server moderation logic (DB layer)**

**Goal:** Pure-ish, testable state transitions with bans, behind the service-role
client.

**Requirements:** M1, M2, M7

**Dependencies:** Unit 1

**Files:**
- Create `apps/web/src/db/admin-moderation.ts` (`import "server-only"`):
  `disableUser`, `enableUser`, `softDeleteUser`, `restoreUser` — each
  `// service-role: explicit user filter required` (`.eq("id", userId)` on every
  write). Each: fetch the target row (404 if missing), check state (409 on illegal
  transition, e.g. restore a non-deleted user / disable an already-deleted user),
  apply the `users` update, then ban/unban via `admin.auth.admin.updateUserById`.
  Export `MODERATION_GRACE_DAYS = 30` + `purgeEligibleAt(deletedAt)` helper (for the
  deferred sweeper). Return a discriminated result `{ ok } | { error:"not_found" } |
  { error:"conflict" }`.
- Test: `apps/web/src/db/__tests__/admin-moderation.unit.test.ts` (mock
  `createAdminClient` incl. `auth.admin`): disable sets `disabled_at` + bans; enable
  clears + unbans; softDelete sets `deleted_at` + bans; restore clears + unbans;
  restore-out-of-grace / restore-live → conflict; missing row → not_found; the row
  update carries the `id` filter.

**Approach:** Ban duration `"876000h"` (~100y) = disable; `"none"` = enable. Order:
DB update first, then ban; on ban failure surface an error so the route returns 500
(no half-applied silent state). Mirror `admin-users.ts` safety comments.

**Verification:** all transitions covered; illegal transitions rejected.

- [x] **Unit 4: Moderation API route (audit + CSRF + email wiring)** ⭐ headline

**Goal:** The single guarded mutation endpoint; the route test that mirrors
`login/__tests__/route.test.ts`.

**Requirements:** M1, M2, M3, M5, M6

**Dependencies:** Units 2, 3

**Files:**
- Create `packages/shared/src/admin-moderation.ts`:
  `UserModerationRequestSchema = z.object({ action: z.enum(["disable","enable",
  "delete","restore"]), reasonCode: ModerationReasonCodeSchema.optional(), reason:
  z.string().max(500).optional() })` (+ refine: reasonCode required for
  disable/delete). Barrel-export.
- Create `apps/web/app/api/admin/users/[id]/moderation/route.ts` `POST`: CSRF →
  `requireAdmin` → validate `id` uuid + body → dispatch to `admin-moderation` →
  on disable|delete call `notifyModeration` (best-effort) → `writeAudit({ action:
  "admin.users.<action>", targetUserId:id, ip, sessionId, metadata:{ reasonCode,
  emailed } })` → map result to 200/400/404/409/500.
- Test: `apps/web/app/api/admin/users/[id]/moderation/__tests__/route.test.ts`
  (mirror login test; mock `requireAdmin`, `admin-moderation`, `notifyModeration`,
  `writeAudit`; keep `isSameOriginRequest` real).

**Test scenarios:**
- CSRF: cross-site → 403 before any dispatch; absent `Sec-Fetch-Site` → 403.
- Auth: no session → 401, no dispatch.
- Validation: bad JSON → 400; unknown action → 400; disable without reasonCode → 400;
  non-uuid id → 400.
- Happy: each action → 200, dispatch called once, `writeAudit` called with the
  matching `admin.users.<action>`.
- **Non-PII audit:** with `reason:"contains alice@x.com"`, the serialized audit arg
  must NOT contain the free-text/email (assert like the users.view test).
- State: not_found → 404; illegal transition → 409.
- Email best-effort: `notifyModeration` throws → action still 200, `emailed:false`.

**Verification:** `pnpm --filter web test` green for the route.

- [x] **Unit 5: Directory UI — status, deleted view, row actions, type-to-confirm**

**Goal:** Surface moderation on the existing read-only users table.

**Requirements:** M8, M9

**Dependencies:** Unit 4

**Files:**
- Modify `apps/web/src/db/admin-users.ts`: select `disabled_at` (+ `deleted_at` in
  deleted view); add `status?: "active" | "deleted"` option (active view keeps
  `deleted_at IS NULL`; deleted view = `deleted_at IS NOT NULL`, returns days-left).
  Keep columns minimal (no role_flags/tokens). Update `admin-users.unit.test.ts`.
- Modify `apps/web/app/api/admin/users/route.ts`: pass through `status`; audit
  metadata stays non-PII (add `status` flag only).
- Modify `users/_components/users-table.tsx`: Status column + badge; an
  Active/"Deleted (in grace)" toggle; an Actions column.
- Create `users/_components/moderation-actions.tsx` (client): Disable/Enable/Delete/
  Restore buttons + dialogs. **Type-to-confirm** on Delete (type the user's email or
  `DELETE`) — UX guard only; reasonCode select + optional free-text reason; `POST`s
  the moderation route with `sec-fetch-site` same-origin (same fetch origin as the
  existing table); optimistic refresh; loading/error states.
- Test: `admin-users.unit.test.ts` (status filter). (UI dialogs covered by the
  route + DB tests; no new E2E harness introduced.)

**Approach:** Reuse the table's existing fetch/debounce/abort patterns + CSS vars.
Destructive confirm is client-only; the server trusts CSRF + session.

**Verification:** operator can disable/enable, delete (with type-to-confirm) and see
it leave the active list, switch to the deleted view, and restore within grace.

## System-Wide Impact

- **DB:** +2 nullable columns + 1 partial index on `users`; no data backfill; no
  cascade/RLS/realtime change.
- **Config:** +2 env vars (`BREVO_API_KEY`, `EMAIL_SENDER`), warn-not-fatal.
- **API:** +1 route; `GET /api/admin/users` gains a `status` param (back-compat).
- **Shared:** `UserRowSchema` gains 2 fields; +2 new schemas.
- **No new npm dependency** (Brevo + ban via `fetch` / existing service-role client).

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Ban leaves ~1h of valid access tokens | Documented; acceptable for moderation. Sweeper/forced-signout is a follow-up. |
| Brevo sender not verified → sends fail | Setup verifies sender; sends are best-effort + audited `emailed:false`; action still succeeds. |
| Secret leakage of `BREVO_API_KEY` | Only in `.env.local` (gitignored) + Vercel env; never repo/shell/doc per AGENTS.md. |
| Half-applied state (row updated, ban failed) | DB-first then ban; ban failure → 500 surfaced (no silent partial); operator retries (idempotent). |
| PII in immutable audit | Audit stores `reasonCode` + `emailed` only; route test asserts free-text/email never serialized. |
| Restoring after data already purged | Purge is deferred; within grace `deleted_at` tombstone keeps all data intact. |

## Documentation / Operational Notes

- Add a short runbook note (infra/ or the admin section) for the deferred **purge
  sweeper** and the **banned-token lag**.
- Record a `docs/solutions/*.md` if the Brevo/`fetch` or GoTrue-ban wiring yields a
  non-obvious learning (per AGENTS.md "Closing a unit").

## Sources & References
- `docs/brainstorms/2026-05-21-admin-dashboard-requirements.md` (Deferred → User
  moderation; R1/R2/R9).
- `AGENTS.md` (RLS/service-role posture; Secrets; migrations).
- Code: `admin-audit.ts`, `admin-guard.ts`, `admin-session.ts`, `admin.ts`,
  `admin-users.ts`, `backups/[id]/route.ts`, `config.ts`, `users.ts`,
  `login/__tests__/route.test.ts`, migrations `0001`/`0010`/`0016`.
