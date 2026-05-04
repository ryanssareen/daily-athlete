/**
 * Helpers for managing test users in Supabase via the Admin API (service-role
 * key). Each e2e run creates ephemeral users with random emails and tears them
 * down after.
 */
const SUPABASE_URL =
  process.env.E2E_SUPABASE_URL ?? "https://gukhwozgnunbqzllobbd.supabase.co";
const SERVICE_ROLE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!SERVICE_ROLE_KEY) {
  // The harness must fail loudly without it, so individual tests don't time out.
  throw new Error(
    "E2E_SUPABASE_SERVICE_ROLE_KEY is required to run auth e2e tests. " +
      "Set it before invoking `pnpm e2e`.",
  );
}

const adminHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
} as const;

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

export function makeRandomEmail(prefix = "e2e"): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}+${ts}-${rand}@da2-test.local`;
}

export async function createConfirmedUser(opts?: {
  email?: string;
  password?: string;
}): Promise<TestUser> {
  const email = opts?.email ?? makeRandomEmail();
  const password = opts?.password ?? `Pa$$w0rd-${Math.random().toString(36).slice(2, 12)}`;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createConfirmedUser failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { id: string };
  return { id: data.id, email, password };
}

export async function deleteUser(id: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: adminHeaders,
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`deleteUser(${id}) failed: ${res.status} ${body}`);
  }
}

export async function findUserByEmail(email: string): Promise<{ id: string } | null> {
  const url = new URL(`${SUPABASE_URL}/auth/v1/admin/users`);
  url.searchParams.set("email", email);
  const res = await fetch(url, { headers: adminHeaders });
  if (!res.ok) return null;
  const data = (await res.json()) as { users?: Array<{ id: string; email?: string }> };
  const match = data.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return match ? { id: match.id } : null;
}
