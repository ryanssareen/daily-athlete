import type { ConfigContext, ExpoConfig } from "expo/config";

// app.json holds the static config; this layer injects real values from the
// environment (Expo CLI loads apps/mobile/.env into process.env before this
// runs). Without it, `extra` keeps the literal "$SUPABASE_URL" placeholders.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "DA2",
  slug: config.slug ?? "da2",
  extra: {
    ...config.extra,
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
    apiUrl: process.env.API_URL ?? process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000",
    stravaClientId: process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID ?? "",
  },
});
