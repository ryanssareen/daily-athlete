# Daily-Athlete MCP Connector

Connects Claude.ai (and any MCP-capable AI client) to your training data. Once connected, the AI can read and write your profile, completed workouts, planned workouts, training plans, and training load — without you switching apps or copy-pasting.

## Prerequisites

Before connecting, the following must be in place on the server:

| Vercel secret | Source |
|---|---|
| `MCP_OAUTH_STATE_SIGNING_KEY` | Generate: `openssl rand -hex 32` |
| `SUPABASE_JWT_SECRET` | Supabase dashboard → project → Settings → API → JWT Secret |

## Connect Claude.ai

1. Open [Claude.ai](https://claude.ai) → Settings → Connectors → Add custom connector
2. Enter the MCP server URL:
   ```
   https://thedailyathlete.in/api/mcp
   ```
   Any of the project's production domains work (`thedailyathlete.in`, `www.thedailyathlete.in`, or `da2-one.vercel.app`) — all three serve Production directly with no redirect between them. Historically `thedailyathlete.in` 307-redirected to `www.thedailyathlete.in` at the Vercel domain level; that broke discovery, since MCP clients are not required to follow a redirect when fetching `.well-known` metadata (RFC 9728 §3.1 expects it served directly at the resource's own origin). Fixed by setting `thedailyathlete.in` to "Connect to an environment → Production" instead of "Redirect to Another Domain" in Vercel → Project → Settings → Domains. If you ever add another domain to this project, connect it the same way — don't set it to redirect.
3. Claude performs automatic discovery (RFC 9728 / RFC 8414), then opens the OAuth consent flow
4. Sign in with your Daily-Athlete account and click **Approve**
5. Done — the connector appears in your Claude conversation tool list

## Available tools

| Tool | What it does |
|---|---|
| `profile_get` | Read your athlete profile (manual fields) |
| `profile_update` | Update bio, height, weight, resting HR, FTP |
| `workouts_completed_list` | List recent completed workouts (filters: sport, date range, limit ≤200) |
| `workouts_completed_get` | Get a single completed workout by ID |
| `workouts_completed_log` | Log a new workout manually |
| `workouts_completed_edit` | Edit a completed workout's fields |
| `workouts_completed_delete` | Delete a completed workout (safety check: refuses matched workouts) |
| `workouts_planned_list` | List planned workouts (filters: plan, date range, status) |
| `workouts_planned_get` | Get a single planned workout by ID |
| `workouts_planned_create` | Create a planned workout in a plan you own |
| `workouts_planned_edit` | Edit a planned workout (requires version for concurrency safety) |
| `workouts_planned_move` | Move a planned workout to a different date (requires version) |
| `workouts_planned_delete` | Delete a planned workout |
| `plans_list` | List your training plans |
| `plans_get` | Get a single plan by ID |
| `training_load_summary` | Compute CTL/ATL/TSB training stress balance |

All writes are attributed `edited_by_kind='agent'` in the audit log. Planned workout edits require a `version` token (optimistic concurrency — prevents overwriting concurrent changes).

## Revoke access

To disconnect Claude.ai or any other client, delete your session from the app (if a revoke-sessions UI is added) or delete your account token rows directly:

```sql
-- run as yourself via psql or the app's DB console
delete from oauth_access_tokens where user_id = auth.uid();
```

Re-running the OAuth flow in Claude.ai settings will re-issue a fresh token.

## What the connector cannot access

The following are never exposed regardless of scope:

- Strava tokens or raw Strava payloads
- Internal derived columns (baselines, EWMA, device-power fields)
- Other users' data (all queries run under your own RLS session)
- Admin or billing tables

## Environment variables reference

```bash
# Required for the OAuth authorization server
MCP_OAUTH_STATE_SIGNING_KEY=<64 hex chars>   # HMAC-SHA256 key for consent state tokens
SUPABASE_JWT_SECRET=<secret>                  # From Supabase dashboard → Settings → API

# Already present (not new)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```
