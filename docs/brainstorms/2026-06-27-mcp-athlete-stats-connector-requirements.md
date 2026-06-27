---
date: 2026-06-27
topic: mcp-athlete-stats-connector
---

# MCP Connector — Athlete Stats CRUD

## Summary

A remote MCP connector, served from the existing `apps/web` deployment, that lets Claude (or any MCP client) read and write the connected athlete's own Daily-Athlete training data. Connection is authorized through an OAuth flow that rides on the user's existing Supabase account, and every tool call runs under that user's identity so RLS scopes all data access to their rows.

## Problem Frame

The athlete already does their training thinking inside an AI assistant (Claude, ChatGPT, etc.), but their Daily-Athlete data lives behind the app. Today the only way to get it into that conversation is by hand — typing or pasting numbers — which is lossy and leaves the model blind to everything it can't see (training load, the active plan, recent trend). This is a personal-use tool, not a product surface: the goal is to remove the copy-paste tax for the people building the app, not to ship a connector to a customer base.

## Key Decisions

- **Remote HTTP, not local stdio.** The connector is hosted so it works from Claude.ai web and mobile, not just a desktop client. This is what forces a real OAuth flow rather than a pasted API key.
- **OAuth built on Supabase, no new vendor.** The auth layer is implemented in-app and authenticates against the existing Supabase identity (Google / email-password) rather than adopting a managed MCP-auth provider. Trade-off accepted: more code and ownership of the OAuth 2.1 surface in exchange for no external dependency.
- **RLS is the authorization model.** Tools execute under the connected user's identity so Postgres RLS does the row-scoping; no tool path uses a service-role bypass. Authorization correctness inherits from the policies the app already enforces.
- **Writes reuse existing validation.** Tools call through the same shared Zod schemas and RPCs the app's own API uses, rather than writing raw to tables.
- **AI plan generation stays out.** The connector reads plans but does not trigger the Inngest/Groq generation path. Read now, regenerate later.

## Requirements

**Connector & transport**
- R1. The connector is exposed as a remote MCP server reachable by standards-compliant MCP clients (Claude.ai web + mobile, Claude Desktop, and others), served from the existing `apps/web` deployment with no separate service.
- R2. It speaks the MCP protocol over HTTP transport so any compliant client can connect, not only Claude.

**Authentication**
- R3. Connecting requires the user to authenticate; the server hosts an OAuth flow that authenticates against the user's existing Supabase account (Google or email/password) with no separate credential set.
- R4. A user can add the connector to Claude by URL and complete authorization without manual client or credential setup (the server advertises the discovery and client-registration the Claude.ai connector flow expects).

**Authorization & data safety**
- R5. Every tool call executes under the connected user's identity so RLS scopes all reads and writes to that user's rows; no tool path uses a service-role bypass.
- R6. Writes go through the same shared Zod validation and RPCs the app's own API uses — tools never write raw to tables.
- R7. Sensitive surfaces are never exposed as tools and never appear in returned payloads: Strava tokens, Strava raw payloads, entitlements/billing, and admin tables.

**Tool surface — CRUD over the athlete's own stats**
- R8. Profile: read and update the athlete profile (thresholds, zones, FTP, weight, and similar).
- R9. Completed workouts: list, read, log (create), edit, and delete.
- R10. Planned workouts: list, read, create, edit, and delete — including edits that change the athlete's active plan.
- R11. Plans: list and read (read-only).
- R12. Training load / trend: a read-only summary so the client has trend context without raw-querying every workout.

## Key Flows

- F1. First-time connect
  - **Trigger:** User adds the connector URL in their MCP client.
  - **Steps:** Client discovers the server's auth requirement; user is sent to the Supabase login; user grants access; client receives a token bound to that user; tools become available.
  - **Outcome:** The client can call tools as that authenticated athlete.
  - **Covers R3, R4.**

- F2. A CRUD tool call
  - **Trigger:** The model calls a tool, e.g. log a completed workout or edit a planned workout.
  - **Steps:** Server validates input with the shared schema; executes the operation under the user's identity; RLS scopes it to the user's rows; returns the result.
  - **Outcome:** The change is identical to performing the same action in-app.
  - **Covers R5, R6, R9, R10.**

## Acceptance Examples

- AE1. **Covers R5.** A tool call only ever returns or affects the connected user's own rows. A request shaped to touch another user's data resolves to nothing because RLS denies it — there is no path to widen scope through the connector.
- AE2. **Covers R10.** Editing or deleting a planned workout through the connector changes the athlete's active plan exactly as the in-app edit does, preserving the app's existing versioning and soft-delete behavior.
- AE3. **Covers R7.** There is no tool that reads Strava tokens, raw payloads, billing, or admin data, and no returned payload includes those fields.

## Scope Boundaries

**Deferred for later**
- Triggering AI plan generation or regeneration from the connector (the Inngest/Groq path) — plans are read-only for now.
- Applying weekly-review adaptations through the connector.
- Coach-facing tools (roster management, `coach_athlete_links`).
- Granular per-tool OAuth scopes or per-action consent — a single all-or-nothing access scope is sufficient for personal use.
- Productizing for external users: multi-tenant onboarding, marketplace listing, quotas/rate-limiting hardening.

**Outside scope (never exposed)**
- Strava tokens and raw payloads, entitlements/billing, and admin tables — these are service-role-only surfaces that the connector must never surface (see R7).

## Dependencies / Assumptions

- Identity comes from the existing Supabase auth (Google + email/password); the OAuth layer bridges to it rather than introducing a new identity store.
- The connector's safety depends on every exposed table already having complete RLS coverage. This holds under the repo's RLS posture, but each table added to the tool surface must be confirmed covered.
- The existing shared Zod schemas and RPCs cover the write operations the tools need; any gap is surfaced during planning.
- Personal use (1–2 people). The connector is not hardened for public multi-tenant load.

## Outstanding Questions

**Deferred to Planning**
- OAuth implementation specifics: token format, storage, lifetime, refresh, and how the MCP access token maps to a Supabase session.
- The MCP server/transport approach for Next.js App Router (adapter library vs. hand-rolled handler).
- Whether the training-load / trend summary reuses an existing aggregation or needs a new read path.
- Whether any rate-limiting or abuse protection is warranted at personal-use scale, or explicitly none.
