# DA2 Mobile (Athlete app)

Expo / React Native app for athletes.

## Setup

```bash
cp .env.example .env
# fill SUPABASE_URL, SUPABASE_ANON_KEY, API_URL
pnpm install   # from repo root
```

## Run

```bash
pnpm --filter @da2/mobile start
# Then press `i` for iOS sim, `a` for Android, or scan QR with Expo Go.
```

## Layout

```
app/                       Expo Router routes (file-based)
  _layout.tsx              Root: auth gate, providers
  (auth)/sign-in.tsx       Email + magic-link sign-in
  (tabs)/                  Authenticated app
    _layout.tsx            Tab bar
    index.tsx              Today
    calendar.tsx           Calendar
    insights.tsx           Insights feed
    profile.tsx            Profile
src/
  auth/supabase.ts         Supabase client (auth + realtime)
  api/client.ts            Typed fetch wrapper for FastAPI
  design/tokens.ts         Colors + typography
  realtime/supabase.ts     Realtime channel helpers (used in later phases)
```
