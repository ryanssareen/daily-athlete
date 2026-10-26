# E2E smoke suite

Runs against a deployed URL, not a local server.

```bash
cd apps/web
E2E_BASE_URL=https://thedailyathlete.in \
E2E_ATHLETE_EMAIL=... E2E_ATHLETE_PASSWORD=... \
E2E_COACH_EMAIL=...   E2E_COACH_PASSWORD=... \
pnpm e2e
```

Specs that need credentials skip themselves when the variables are missing.
Use the QA fixture accounts only (`qa-athlete@da2-test.local`, `qa-coach@da2-test.local`), never real users.
The admin console uses a shared-password cookie and is not covered.
