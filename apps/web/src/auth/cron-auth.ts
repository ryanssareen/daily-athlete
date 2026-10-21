import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Bearer-token gate for CRON_SECRET-protected routes. Fails CLOSED when the
 * secret is unset (comparing against `Bearer ${undefined}` would otherwise
 * accept the literal header "Bearer undefined") and compares in constant time.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron-auth] CRON_SECRET is not set; refusing");
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  const a = Buffer.from(header, "utf8");
  const b = Buffer.from(`Bearer ${secret}`, "utf8");
  // timingSafeEqual throws on unequal lengths; a length mismatch is already a
  // reject and leaks nothing beyond the (non-secret) header length.
  return a.length === b.length && timingSafeEqual(a, b);
}
