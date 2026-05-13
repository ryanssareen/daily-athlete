// CI guard: assert that the supabase_realtime publication membership
// matches the allow-list in packages/shared/src/realtime-allowlist.ts.
//
// Without this check, a future migration could silently
//   ALTER PUBLICATION supabase_realtime ADD TABLE public.<sensitive>;
// and nothing would catch it. The comment-only enforcement on the
// existing 0001-0003 migrations is informational, not a guard.
//
// Failure messages distinguish "unexpected addition" from "expected but
// missing" so the diff is actionable: a contributor adding a table to
// realtime gets a hint to update the allow-list; a contributor removing
// a table without updating the list gets the inverse hint.

import { describe, expect, it } from "vitest";

import { REALTIME_ALLOWLIST } from "@da2/shared";

import { serviceClient } from "./setup";

async function currentRealtimeTables(): Promise<string[]> {
  const admin = serviceClient();
  const { data, error } = await admin.rpc("realtime_publication_tables");
  expect(error).toBeNull();
  if (!Array.isArray(data)) throw new Error("rpc returned non-array");
  return (data as Array<{ tablename: string }>)
    .map((r) => r.tablename)
    .sort();
}

describe("supabase_realtime publication allow-list guard", () => {
  it("publication members match the in-repo allow-list", async () => {
    const live = await currentRealtimeTables();
    const allowed = [...REALTIME_ALLOWLIST].sort();

    const unexpected = live.filter((t) => !allowed.includes(t));
    const missing = allowed.filter((t) => !live.includes(t));

    expect(
      unexpected,
      `Unexpected tables in supabase_realtime publication:\n  ${unexpected.join(", ")}\n\n` +
        `Either:\n` +
        `  (a) add them to REALTIME_ALLOWLIST in packages/shared/src/realtime-allowlist.ts\n` +
        `      if their presence is intentional, OR\n` +
        `  (b) ALTER PUBLICATION supabase_realtime DROP TABLE in a new migration\n` +
        `      if they slipped in by mistake.`,
    ).toEqual([]);

    expect(
      missing,
      `Tables listed in REALTIME_ALLOWLIST but NOT in the live publication:\n  ${missing.join(", ")}\n\n` +
        `Either:\n` +
        `  (a) add ALTER PUBLICATION supabase_realtime ADD TABLE public.<table>\n` +
        `      to a migration if they should be members, OR\n` +
        `  (b) remove them from REALTIME_ALLOWLIST in\n` +
        `      packages/shared/src/realtime-allowlist.ts.`,
    ).toEqual([]);
  });
});
