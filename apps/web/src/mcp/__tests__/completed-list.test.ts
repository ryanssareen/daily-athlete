// Handler-level tests for workouts_completed_list: the athlete-local day bounds.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerAllTools } from "../tools";

interface Calls {
  gte: unknown[][];
  lt: unknown[][];
  lte: unknown[][];
  usersReads: number;
}

let calls: Calls;
let usersResult: { data: { timezone: string | null } | null; error: { message: string } | null };

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "is", "order", "limit", "eq"]) c[m] = () => c;
  c.gte = (...a: unknown[]) => (calls.gte.push(a), c);
  c.lt = (...a: unknown[]) => (calls.lt.push(a), c);
  c.lte = (...a: unknown[]) => (calls.lte.push(a), c);
  c.maybeSingle = async () => result;
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return c;
}

vi.mock("../identity", () => ({
  rlsClientFromAuth: () => ({
    identity: { userId: "u1" },
    supabase: {
      from: (table: string) => {
        if (table === "users") {
          calls.usersReads++;
          return chain(usersResult);
        }
        return chain({ data: [], error: null });
      },
    },
  }),
}));

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function listHandler(): Handler {
  let handler: Handler | undefined;
  registerAllTools({
    registerTool: (name: string, _cfg: unknown, h: Handler) => {
      if (name === "workouts_completed_list") handler = h;
    },
  } as never);
  if (!handler) throw new Error("handler not registered");
  return handler;
}

const run = (args: Record<string, unknown>) => listHandler()(args, {});

beforeEach(() => {
  calls = { gte: [], lt: [], lte: [], usersReads: 0 };
  usersResult = { data: { timezone: "Asia/Kolkata" }, error: null };
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("workouts_completed_list day bounds", () => {
  it("filters on the IST local-day instants and never uses lte", async () => {
    const res = await run({ from: "2026-10-19", to: "2026-10-19" });
    expect(res.isError).toBeUndefined();
    expect(calls.gte).toEqual([["started_at", "2026-10-18T18:30:00.000Z"]]);
    expect(calls.lt).toEqual([["started_at", "2026-10-19T18:30:00.000Z"]]);
    expect(calls.lte).toEqual([]);
  });

  it("skips the users lookup when neither from nor to is given", async () => {
    await run({});
    expect(calls.usersReads).toBe(0);
    expect(calls.gte).toEqual([]);
    expect(calls.lt).toEqual([]);
  });

  it("falls back to UTC when the users row is missing or its timezone is null", async () => {
    usersResult = { data: null, error: null };
    await run({ from: "2026-10-19", to: "2026-10-19" });
    expect(calls.gte).toEqual([["started_at", "2026-10-19T00:00:00.000Z"]]);
    expect(calls.lt).toEqual([["started_at", "2026-10-20T00:00:00.000Z"]]);

    calls = { gte: [], lt: [], lte: [], usersReads: 0 };
    usersResult = { data: { timezone: null }, error: null };
    await run({ from: "2026-10-19" });
    expect(calls.gte).toEqual([["started_at", "2026-10-19T00:00:00.000Z"]]);
  });

  it("returns read_failed (not a UTC fallback) when the timezone read errors", async () => {
    usersResult = { data: null, error: { message: "boom" } };
    const res = await run({ from: "2026-10-19" });
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toBe("read_failed");
    expect(calls.gte).toEqual([]);
  });

  for (const [name, args] of [
    ["from after to", { from: "2026-10-20", to: "2026-10-19" }],
    ["impossible day", { from: "2026-02-31" }],
    ["month 13", { to: "2026-13-01" }],
    ["year overflow", { to: "9999-12-31" }],
  ] as const) {
    it(`rejects ${name} with invalid_date and no query`, async () => {
      const res = await run({ ...args });
      expect(res.isError).toBe(true);
      expect(JSON.parse(res.content[0].text).error).toBe("invalid_date");
      expect(calls.usersReads).toBe(0);
      expect(calls.gte).toEqual([]);
    });
  }
});
