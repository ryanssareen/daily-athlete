# DA2 Web (Coach app)

Next.js 15 (App Router) for coaches.

## Setup

```bash
cp .env.example .env.local
pnpm install   # from repo root
pnpm --filter @da2/web dev
```

## Layout

```
app/
  layout.tsx                Root layout
  page.tsx                  Marketing landing
  (auth)/sign-in/page.tsx   Email magic-link sign-in
  (coach)/                  Authenticated coach surface
    layout.tsx              Sidebar + auth gate
    roster/page.tsx         Athletes linked to this coach
    athletes/[id]/page.tsx  Per-athlete plan + edit (Phase 4)
src/
  auth/supabase.ts          Supabase browser client
  auth/server.ts            Supabase server client (cookies)
  api/client.ts             Server + browser typed fetch wrapper
```
