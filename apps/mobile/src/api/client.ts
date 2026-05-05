import Constants from "expo-constants";

import { supabase } from "@/auth/supabase";

// Points at the Next.js app (apps/web) which now hosts the API under /api/*.
// Local dev: `pnpm --filter @da2/web dev` runs on :3000. Override via
// EXPO_PUBLIC_API_URL / app.config.ts extra.apiUrl in staging + prod.
const apiUrl = (Constants.expoConfig?.extra?.apiUrl as string) ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(`${apiUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text || response.statusText);
  }
  return (await response.json()) as T;
}
