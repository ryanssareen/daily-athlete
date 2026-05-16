function normalizeOrigin(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim().replace(/\/+$/, "");
  if (!trimmed) return undefined;

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const defaultScheme =
    trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1")
      ? "http"
      : "https";
  const candidate = hasScheme ? trimmed : `${defaultScheme}://${trimmed}`;

  try {
    return new URL(candidate).origin;
  } catch {
    return undefined;
  }
}

/** Origin used for Supabase Auth redirectTo. */
export function getAuthRedirectOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;

  const fromSite = normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (fromSite) return fromSite;

  const fromPublicVercel = normalizeOrigin(process.env.NEXT_PUBLIC_VERCEL_URL);
  if (fromPublicVercel) return fromPublicVercel;

  const fromVercel = normalizeOrigin(process.env.VERCEL_URL);
  if (fromVercel) return fromVercel;

  return "http://localhost:3000";
}

export function authCallbackUrl(nextPath: string): string {
  const next =
    nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const url = new URL("/auth/callback", getAuthRedirectOrigin());
  url.searchParams.set("next", next);
  return url.toString();
}
