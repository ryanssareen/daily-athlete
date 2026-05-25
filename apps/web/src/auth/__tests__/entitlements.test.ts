// Unit tests for the canonical entitlement gate
// (apps/web/src/auth/entitlements.ts).
//
// These are PURE unit tests: no DB, no Supabase network. We hand a fake
// supabase-js client to hasActiveEntitlement/requireEntitlement and assert
// on the resolved boolean / NextResponse and on the filters the helper built.
//
// The fake mirrors the postgrest builder chain the helper actually calls:
//   .from(table).select(cols).eq(...).eq(...).eq(...).or(expr)
//     .limit(n).maybeSingle()
// Each .eq()/.or() records the filter and returns `this`; .maybeSingle()
// resolves the configured result. This is the same makeSupabaseFake style as
// apps/web/app/api/activities/manual/__tests__/route.test.ts.

import { beforeEach, describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasActiveEntitlement, requireEntitlement } from "../entitlements";

// ---------------------------------------------------------------------------
// Fake supabase client
// ---------------------------------------------------------------------------

type MaybeSingleResult = {
  data: Record<string, unknown> | null;
  error: { message: string; code?: string } | null;
};

interface CapturedQuery {
  table: string;
  selected: string;
  eqFilters: Record<string, unknown>;
  orExpr: string | null;
  limit: number | null;
}

function makeSupabaseFake(result: MaybeSingleResult) {
  const captured: CapturedQuery = {
    table: "",
    selected: "",
    eqFilters: {},
    orExpr: null,
    limit: null,
  };

  class QueryBuilder {
    select(cols: string) {
      captured.selected = cols;
      return this;
    }
    eq(col: string, val: unknown) {
      captured.eqFilters[col] = val;
      return this;
    }
    or(expr: string) {
      captured.orExpr = expr;
      return this;
    }
    limit(n: number) {
      captured.limit = n;
      return this;
    }
    async maybeSingle(): Promise<MaybeSingleResult> {
      return result;
    }
  }

  const client = {
    from(table: string) {
      captured.table = table;
      return new QueryBuilder();
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

const ROW = { user_id: "11111111-1111-1111-1111-111111111111" };

// ---------------------------------------------------------------------------
// hasActiveEntitlement
// ---------------------------------------------------------------------------

describe("hasActiveEntitlement", () => {
  it("happy path: an active ai_plans row → true", async () => {
    const { client } = makeSupabaseFake({ data: ROW, error: null });
    const ok = await hasActiveEntitlement(client, ROW.user_id, "ai_plans");
    expect(ok).toBe(true);
  });

  it("builds the documented filters (table, active, key, user, now)", async () => {
    const { client, captured } = makeSupabaseFake({ data: ROW, error: null });
    await hasActiveEntitlement(client, ROW.user_id, "ai_plans");

    expect(captured.table).toBe("entitlements");
    expect(captured.eqFilters.user_id).toBe(ROW.user_id);
    expect(captured.eqFilters.entitlement_key).toBe("ai_plans");
    expect(captured.eqFilters.active).toBe(true);
    // expires_at IS NULL OR expires_at > now()
    expect(captured.orExpr).toMatch(/^expires_at\.is\.null,expires_at\.gt\./);
  });

  it("edge: no matching row (e.g. expires_at in the past) → false", async () => {
    // The DB filter excludes a past expires_at, so PostgREST returns no row.
    const { client } = makeSupabaseFake({ data: null, error: null });
    const ok = await hasActiveEntitlement(client, ROW.user_id, "ai_plans");
    expect(ok).toBe(false);
  });

  it("edge: active=false (no row matches active=true filter) → false", async () => {
    const { client } = makeSupabaseFake({ data: null, error: null });
    const ok = await hasActiveEntitlement(client, ROW.user_id, "ai_plans");
    expect(ok).toBe(false);
  });

  it("fails closed: a query error → false (never grant on error)", async () => {
    const { client } = makeSupabaseFake({
      data: null,
      error: { message: "boom", code: "57014" },
    });
    const ok = await hasActiveEntitlement(client, ROW.user_id, "ai_plans");
    expect(ok).toBe(false);
  });

  it("integration-ish: service-role-style call carries the explicit user_id filter", async () => {
    // Under a service-role admin client RLS is bypassed, so the explicit
    // user_id filter is the only security boundary. Assert it is always present.
    const otherUser = "22222222-2222-2222-2222-222222222222";
    const { client, captured } = makeSupabaseFake({ data: ROW, error: null });
    await hasActiveEntitlement(client, otherUser, "ai_plans");
    expect(captured.eqFilters.user_id).toBe(otherUser);
    expect(captured.eqFilters.entitlement_key).toBe("ai_plans");
  });
});

// ---------------------------------------------------------------------------
// requireEntitlement
// ---------------------------------------------------------------------------

describe("requireEntitlement", () => {
  it("happy path: entitled → null (route proceeds)", async () => {
    const { client } = makeSupabaseFake({ data: ROW, error: null });
    const gate = await requireEntitlement(client, ROW.user_id, "ai_plans");
    expect(gate).toBeNull();
  });

  it("error path: no entitlement row → 402 NextResponse", async () => {
    const { client } = makeSupabaseFake({ data: null, error: null });
    const gate = await requireEntitlement(client, ROW.user_id, "ai_plans");
    expect(gate).not.toBeNull();
    expect(gate!.status).toBe(402);
    const body = await gate!.json();
    expect(body.error).toBe("payment_required");
    expect(body.entitlement_key).toBe("ai_plans");
  });

  it("error path: query error → 402 (fail closed)", async () => {
    const { client } = makeSupabaseFake({
      data: null,
      error: { message: "boom", code: "57014" },
    });
    const gate = await requireEntitlement(client, ROW.user_id, "ai_plans");
    expect(gate?.status).toBe(402);
  });
});
