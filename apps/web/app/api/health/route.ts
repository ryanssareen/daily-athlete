/**
 * GET /api/health — liveness probe. No auth, no DB.
 *
 * Parity with `apps/api/src/api/health.py`:
 *   200 → {"status": "ok"}
 *
 * Kept dynamic so a stale CDN cache can never mask an outage.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ status: "ok" });
}
