# Pivot Preflight — Your Action Checklist

**Total time:** ~45 minutes.
**You'll need:** a browser, a free Supabase account, a free Vercel account.
**You will NOT use:** your real da2 project. Everything in this checklist runs against throwaway accounts/projects you delete at the end.

When you finish, fill in the four `**Result:**` fields in [docs/solutions/preflight-verification-2026-05.md](preflight-verification-2026-05.md), commit, and tell me. I'll either start Unit 1 or revise the plan based on what you found.

---

## Step 0 — Set up the throwaway environments (10 min)

- [ ] **Sign in to Supabase** at https://supabase.com (use any account; you don't need to use the same one you'll use for production).
- [ ] **Create a new project**:
  - Click **New project**
  - Name: `da2-preflight`
  - Database password: anything (write it down briefly; you'll delete this in 45 minutes)
  - Region: pick anything close
  - Wait ~2 minutes for it to provision
- [ ] **Sign in to Vercel** at https://vercel.com.
- [ ] **Create a throwaway Next.js app locally** for Probe 3 (you can skip this until Step 4 — instructions there).

---

## Step 1 — Probe 1: `pg_cron` (5 min)

- [ ] Open the Supabase project dashboard → **SQL Editor** (left sidebar).
- [ ] Click **New query** and paste this:

  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_cron';
  ```

- [ ] Click **Run**.
  - **If you get one row back** with `pg_cron` and a version → success so far. Continue.
  - **If you get an error** like "permission denied" or "extension not available" → mark Probe 1 **NOT OK**, skip to Step 5.

- [ ] Test scheduling:

  ```sql
  SELECT cron.schedule('preflight-noop', '*/5 * * * *', $$ SELECT 1 $$);
  SELECT * FROM cron.job WHERE jobname = 'preflight-noop';
  ```

  - **One row returned** with the schedule → Probe 1 is **OK**.
  - **Error** → Probe 1 is **NOT OK**.

- [ ] Clean up:

  ```sql
  SELECT cron.unschedule('preflight-noop');
  ```

- [ ] **Record:** open `docs/solutions/preflight-verification-2026-05.md`, find Probe 1's **Result:** field, change it to `**OK**` or `**NOT OK**`, add 1 line of evidence (e.g., "pg_cron 1.6 installed; cron.schedule returned row").

---

## Step 2 — Probe 2: JWT signing scheme (10 min)

- [ ] In the Supabase project, open **Authentication → Users**.
- [ ] Click **Add user → Create new user**:
  - Email: `alice@example.test`
  - Password: anything
  - Auto-confirm: yes
  - Click **Create**.
- [ ] Open the **API Docs → Auth → Sign in with email** section (or use the SQL editor RPC). Easier path: open `https://<your-project-ref>.supabase.co/auth/v1/token?grant_type=password` in a tool like Postman, OR run this `curl` (replace `<project-ref>` and `<anon-key>` from your project's API settings):

  ```bash
  curl -X POST "https://<project-ref>.supabase.co/auth/v1/token?grant_type=password" \
    -H "apikey: <anon-key>" \
    -H "Content-Type: application/json" \
    -d '{"email":"alice@example.test","password":"<the-password>"}'
  ```

  Copy the `access_token` from the JSON response.

- [ ] Open https://jwt.io. Paste the access token into the **Encoded** box on the left.
- [ ] Look at the **Header** panel (orange, top right). Note the `alg` field:
  - `"alg": "HS256"` → **legacy / shared secret**. Mark Probe 2 **OK**.
  - `"alg": "ES256"` or `"RS256"` → **asymmetric / JWKS**. Mark Probe 2 **OK WITH CAVEAT**.

- [ ] If asymmetric, also confirm the JWKS endpoint works:

  ```bash
  curl https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
  ```

  You should get a JSON document with one or more keys.

- [ ] **Record** in Probe 2's **Result:** field:
  - `**OK**` if HS256, with evidence: `"alg=HS256 in JWT header"`.
  - `**OK WITH CAVEAT**` if asymmetric, with evidence: `"alg=ES256, JWKS reachable at <url>"`. **This means Unit 1's auth.ts will use createRemoteJWKSet instead of a shared secret — flag for me.**

---

## Step 3 — Probe 4: PostgREST JWT propagation (10 min)

(Doing Probe 4 before Probe 3 so you can finish all the Supabase work before switching to Vercel.)

- [ ] In the SQL editor, paste and run:

  ```sql
  CREATE TABLE public.preflight_rows (
      id BIGSERIAL PRIMARY KEY,
      owner UUID NOT NULL,
      data TEXT
  );
  ALTER TABLE public.preflight_rows ENABLE ROW LEVEL SECURITY;
  CREATE POLICY preflight_self_only ON public.preflight_rows
      FOR SELECT USING (auth.uid() = owner);
  ```

- [ ] Add a second user **bob**:
  - **Authentication → Users → Add user**: `bob@example.test` / any password / auto-confirm.

- [ ] Get both users' UUIDs:

  ```sql
  SELECT id, email FROM auth.users WHERE email IN ('alice@example.test', 'bob@example.test');
  ```

  Copy alice's `id` and bob's `id`.

- [ ] Insert one row per user (using the SQL editor, which runs as service-role and bypasses RLS):

  ```sql
  INSERT INTO public.preflight_rows (owner, data) VALUES
      ('<paste-alice-uuid>', 'alice secret'),
      ('<paste-bob-uuid>', 'bob secret');
  ```

- [ ] Get alice's access token (same as Probe 2 step). Save it as `ALICE_JWT`.
- [ ] Get bob's access token by signing in as bob (same `curl` as Step 2 with bob's email + password). Save as `BOB_JWT`.
- [ ] In your terminal, replace `<project-ref>`, `<anon-key>`, and the JWTs:

  ```bash
  echo "Alice's view:"
  curl "https://<project-ref>.supabase.co/rest/v1/preflight_rows?select=*" \
    -H "apikey: <anon-key>" \
    -H "Authorization: Bearer <ALICE_JWT>"
  echo

  echo "Bob's view:"
  curl "https://<project-ref>.supabase.co/rest/v1/preflight_rows?select=*" \
    -H "apikey: <anon-key>" \
    -H "Authorization: Bearer <BOB_JWT>"
  ```

- [ ] Compare:
  - **Alice's request returns only `"alice secret"`, bob's returns only `"bob secret"`** → Probe 4 is **OK**. Mark and record.
  - **Both requests return both rows** → Probe 4 is **NOT OK**. **This is critical — flag for me; we have to redesign auth before Unit 1.**

- [ ] **Record** in Probe 4's **Result:** field with evidence (e.g., "alice JWT returned 1 row, bob JWT returned 1 row, no cross-tenant leakage").

---

## Step 4 — Probe 3: 300s on Vercel Hobby (10 min)

- [ ] In a fresh terminal, create a tiny test app:

  ```bash
  cd /tmp
  npx create-next-app@latest da2-preflight-vercel --typescript --app --no-tailwind --no-eslint --no-src-dir --import-alias "@/*" --no-turbopack
  cd da2-preflight-vercel
  ```

- [ ] Create a long-running route. Make the file `app/api/longrun/route.ts`:

  ```ts
  export const maxDuration = 300;

  export async function GET() {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 120_000)); // 120 seconds
    return Response.json({ ok: true, elapsed_ms: Date.now() - start });
  }
  ```

- [ ] Push it to a throwaway GitHub repo (or use `vercel` CLI — `npx vercel` from the directory and follow prompts to deploy without GitHub).
- [ ] Once deployed, get the URL (something like `https://da2-preflight-vercel.vercel.app`).
- [ ] Test 120s:

  ```bash
  time curl https://<your-deploy>.vercel.app/api/longrun
  ```

  - Returns `{"ok":true,...}` after ~120s → 120s budget works. Continue.
  - Returns 504 / "Function execution timeout" before 120s → mark **OK WITH CAVEAT**, record actual ceiling.

- [ ] If 120s worked, edit the route to sleep for 240 seconds, redeploy:

  ```ts
  await new Promise((r) => setTimeout(r, 240_000));
  ```

- [ ] Test again:
  - Returns `{"ok":true}` after ~240s → Probe 3 is **OK**. The 300s budget is real.
  - Returns timeout before 240s → Probe 3 is **OK WITH CAVEAT**, record actual ceiling (e.g., "180s observed").

- [ ] **Record** in Probe 3's **Result:** field with evidence (e.g., "240s sleep returned successfully, no timeout").

---

## Step 5 — Finalize and tell me (5 min)

- [ ] Open [docs/solutions/preflight-verification-2026-05.md](preflight-verification-2026-05.md).
- [ ] Verify all four **Result:** fields are filled in.
- [ ] Update the **Verification summary** table at the bottom.
- [ ] Change frontmatter `status: pending` to `status: complete`.
- [ ] Update the date if you ran probes on a different day.
- [ ] Commit:

  ```bash
  git add docs/solutions/preflight-verification-2026-05.md
  git commit -m "docs: preflight verification results"
  ```

- [ ] **Delete the throwaway projects:**
  - Supabase: project Settings → General → Delete project.
  - Vercel: project Settings → Advanced → Delete project.
  - Local: `rm -rf /tmp/da2-preflight-vercel`

- [ ] **Tell me:** paste a one-line summary in chat ("Probes 1, 3, 4 OK; Probe 2 OK WITH CAVEAT — alg=ES256"). I'll either advance to Unit 1 or revise the plan.

---

## What outcomes mean (cheat sheet)

| Result | What I'll do |
|---|---|
| Probe 1 **NOT OK** | Reshape Unit 4 to fold retention into the keepalive endpoint. ~30 min plan edit. |
| Probe 2 **OK WITH CAVEAT** (asymmetric) | Switch Unit 1 auth.ts to `createRemoteJWKSet`. Rename env var `SUPABASE_JWT_SECRET` → `SUPABASE_JWT_JWKS_URL`. ~30 min plan edit. |
| All four **OK** | Start Unit 1 as planned. |
| Probe 3 **OK WITH CAVEAT** | Update Unit 7 design note's per-stage budget. Pure docs change. |
| Probe 4 **NOT OK** | **Stop.** This is critical — the entire auth-to-DB architecture changes. Reconvene with full re-plan. |

If anything is genuinely confusing or a step won't work, paste the exact error and I'll debug. 
