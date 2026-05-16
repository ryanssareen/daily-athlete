import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function json(
  body: Record<string, unknown>,
  status = 200,
): NextResponse<Record<string, unknown>> {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Probes Supabase Auth reachability for the configured project URL.
 * Returns 200 when /auth/v1/health responds; 503 when misconfigured or unreachable.
 */
export async function GET() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!rawUrl) {
    return json(
      {
        ok: false,
        error: "missing_env",
        detail: "NEXT_PUBLIC_SUPABASE_URL is not set",
      },
      503,
    );
  }

  let host: string;
  try {
    host = new URL(rawUrl).host;
  } catch {
    return json(
      {
        ok: false,
        error: "invalid_url",
        detail: "NEXT_PUBLIC_SUPABASE_URL is not a valid URL",
      },
      503,
    );
  }

  const healthUrl = `${rawUrl.replace(/\/$/, "")}/auth/v1/health`;
  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return json(
        {
          ok: false,
          error: "auth_unhealthy",
          host,
          status: res.status,
        },
        503,
      );
    }
    return json({ ok: true, host });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(
      {
        ok: false,
        error: "unreachable",
        host,
        detail: message,
        hint:
          "If the Supabase project is paused (INACTIVE), restore it in the Supabase dashboard before signing in.",
      },
      503,
    );
  }
}
