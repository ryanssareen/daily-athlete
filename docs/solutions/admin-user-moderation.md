# Admin user moderation — non-obvious decisions

Context: implementing operator disable/delete for the admin dashboard
(plan: `docs/plans/2026-05-22-001-feat-admin-user-moderation-plan.md`).

## Block login with a Supabase Auth ban, not RLS
"Disabled" = `auth.admin.updateUserById(id, { ban_duration: "876000h" })`; lift
with `{ ban_duration: "none" }`. One service-role call enforces across web +
mobile + API with **no per-table RLS retrofit**. Caveat: existing access tokens
stay valid until natural expiry (~1h) — refresh is what's blocked. Forced
sign-out / token revocation is a deferred follow-up. The `public.users`
`disabled_at` / `deleted_at` columns (migration 0018) are the app-visible mirror
for the directory; the ban is the actual gate.

## Soft-delete reuses `deleted_at` + a grace window
Delete = set `users.deleted_at` (already existed) + ban; 30-day grace
(`MODERATION_GRACE_DAYS`); Restore clears it + unbans. Permanent purge
(`delete_user_cascade` then `auth.admin.deleteUser`) is **not** run here — it's a
deferred sweeper; `purgeEligibleAt()` is the helper it will use. `listUsers`
already filtered `deleted_at IS NULL`; a `status=deleted` view surfaces in-grace
rows for restore.

## Brevo transactional email via plain `fetch`, fail-soft
No SDK dependency: `POST https://api.brevo.com/v3/smtp/email` with an `api-key`
header (`apps/web/src/email/brevo.ts`). The client **never throws** and returns
`{ sent: false, reason }` on any failure, so a moderation action still succeeds
when email is down/unconfigured (audited as `emailed:false`). `BREVO_API_KEY` /
`EMAIL_SENDER` are **warn-not-fatal** in the prod config validator (mirrors
`STRAVA_WEBHOOK_SUBSCRIPTION_ID`) — a missing key disables email, not boot. The
sender must be a *Verified sender* in Brevo; a freemail (`@gmail.com`) sender
works but hurts deliverability — move to a custom domain before relying on it.

## Reason: code persists, free-text is email-only
A normalized `ModerationReasonCode` enum goes to the row + the immutable audit
log (non-PII). The operator's free-text `reason` is rendered into the email body
**only** — never persisted, never audited. The route test asserts the free-text
never appears in the audit payload.

## Type-to-confirm is a UX guard, not CSRF
Delete requires typing the user's email; that's client-only. The server enforces
`Sec-Fetch-Site` (fail-closed) + the admin session like every other admin
mutation.
