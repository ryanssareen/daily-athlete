---
title: Slow page loads and "renders before it finishes loading" (diagnosis, 2026-10-10)
date: 2026-10-10
status: open — issue 1 fix on branch fix/web-slow-layout-chain (unmeasured in prod), issue 2 not reproduced
---

## Issue 1: pages load slowly

### Evidence
- `curl` against prod: `/sign-in` TTFB 0.48-0.50s warm (1.38s on first hit); `/` 0.98s cold. These are public pages with no data work, so the cost is mostly platform latency, not queries.
- `x-vercel-id: bom1::iad1::...` on `/` — edge in Mumbai, function executed in `iad1` (Washington DC).
- Supabase prod project `gukhwozgnunbqzllobbd` is in Southeast Asia (Singapore).
- Runtime logs show some invocations in `region=bom1`, so function placement is not consistent. Not yet explained.
- A logged-in Chrome session measured TTFB 1995ms and response end 4458ms for `/athlete` (which redirected to `/athlete/onboarding`).
- `apps/web/vercel.json` sets only `crons`; no `regions`, no function region configured in the repo.

### Mechanism (supported, not fully proven)
`apps/web/app/(athlete)/layout.tsx` runs a serial chain before it can render anything:
1. `getUserWithRoles()` -> `auth.getUser()` (round trip to Supabase Auth) then a `users` query (second round trip)
2. `athlete_profiles` query (third round trip)
3. then the page's own queries (`apps/web/app/(athlete)/athlete/page.tsx` uses `Promise.all`, so one more round trip)

`loading.tsx` only wraps the page segment, not the layout above it, so none of the skeletons can stream until the layout's chain finishes. With a function in `iad1` and the DB in Singapore (~200ms+ per round trip) that is roughly 4 round trips of dead time before first byte; with the function in `bom1` it is much smaller.

### Fix applied on branch
- `apps/web/vercel.json`: `"regions": ["sin1"]` (next to Supabase Singapore).
- `apps/web/src/auth/roles.ts`: `users` and `athlete_profiles` queries now run in `Promise.all`; `UserWithRoles.onboarded` added; the athlete layout reads it instead of its own serial query. Test: `apps/web/src/auth/__tests__/roles.test.ts`.
- Not yet measured in prod: re-run `curl -w %{time_starttransfer}` on `/sign-in` and `/athlete` after deploy and compare with the numbers above.

### Remaining candidates (not applied)
- Confirm why some requests ran in `iad1` before the region pin (project-level setting may override vercel.json).
- Move the onboarding gate out of the blocking path entirely.
- `athlete_profiles` query in the layout ignores `error`: any failed/timed-out query yields `data = null` -> `manual_fields = {}` -> redirect to `/athlete/onboarding` for an already-onboarded athlete. Should be checked separately.

## Issue 2: "tries to render the page before it fully loads"

Not reproduced. Prior history searched (`git log --grep`, `docs/solutions`) found no earlier fix matching this description verbatim. Closest candidates, none confirmed:
- `7aac81f` (2026-09-08) removed the fake skeleton in `ProposalReview` and set `staleTimes.dynamic: 30`; cached router renders could show stale shells.
- `cb18025` fixed the theme toggle not applying until refresh (307 vs 303); the 30s router cache could reintroduce a similar symptom.
- `fbb661d` (#115) tolerates refresh-token races; prod logs on 2026-10-10 still show `refresh_token_not_found` errors on `GET /`.

Need the exact page and what is visible during load to proceed (see handoff question).
