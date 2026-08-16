import "server-only";

// Intl.DateTimeFormat's constructor is a strict superset of the real IANA
// tz database -- it also accepts raw UTC offsets ("+05:30") and
// sign-inverted POSIX zones ("Etc/GMT+12" is actually UTC-12) without
// throwing, echoing them back verbatim in resolvedOptions().timeZone
// instead of resolving to a canonical zone. Both would be written to
// users.timezone as-is (no DB CHECK constraint backs this column) and be
// silently wrong for half the year in any DST-observing region.
// supportedValuesOf("timeZone") excludes "UTC" itself and legacy aliases
// (e.g. "Asia/Kolkata" resolves to "Asia/Calcutta"), so resolve first,
// then check the *resolved* value against the canonical list.
//
// Shared between the PATCH /api/profile/timezone route (browser self-heal)
// and the MCP profile_update tool (agent-driven), so both surfaces reject
// the same non-canonical strings identically.
const IANA_TIMEZONES = new Set<string>(Intl.supportedValuesOf("timeZone"));

export function isValidIanaTimezone(tz: string): boolean {
  let resolved: string;
  try {
    resolved = Intl.DateTimeFormat(undefined, { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    // Throws RangeError for a syntactically invalid timezone identifier.
    return false;
  }
  return resolved === "UTC" || IANA_TIMEZONES.has(resolved);
}
