// Unit tests for the profile_get / profile_update MCP tool handlers,
// specifically the timezone wiring added alongside the browser-side fix
// (PATCH /api/profile/timezone + TimezoneSync). Before this, an MCP-only
// caller had no way to read or correct a wrong public.users.timezone --
// this reproduces the never-captured-column bug on the agent surface.
//
// @modelcontextprotocol/sdk and mcp-handler are declared dependencies but
// not installed in this dev environment (see AGENTS.md / prior review
// notes) -- tools.ts itself only imports *types* from the SDK (erased at
// build time), so it has no runtime dependency on it. The one real runtime
// dependency on the missing `mcp-handler` package is transitive, via
// ../identity -> mcp-handler's getPublicOrigin. Mocking ../identity below
// means the real identity.ts (and its mcp-handler import) is never
// evaluated, so this test runs without either package installed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const ATHLETE = "athlete-1";

const mocks = vi.hoisted(() => ({
  profileSelect: { data: null as { manual_fields: unknown } | null, error: null as { message: string } | null },
  profileUpdate: { data: null as Record<string, unknown> | null, error: null as { message: string } | null },
  usersSelect: { data: null as { timezone: string | null } | null, error: null as { message: string } | null },
  usersUpdate: { error: null as { message: string } | null },
  calls: [] as { table: string; op: string; arg?: unknown }[],
}));

vi.mock("../identity", () => ({
  rlsClientFromAuth: () => ({
    supabase: {
      from: (table: string) => {
        if (table === "athlete_profiles") {
          return {
            select: (cols: string) => {
              mocks.calls.push({ table, op: "select", arg: cols });
              return { maybeSingle: () => Promise.resolve(mocks.profileSelect) };
            },
            update: (patch: Record<string, unknown>) => {
              mocks.calls.push({ table, op: "update", arg: patch });
              return {
                select: () => ({
                  maybeSingle: () => Promise.resolve(mocks.profileUpdate),
                }),
              };
            },
          };
        }
        if (table === "users") {
          return {
            select: (cols: string) => {
              mocks.calls.push({ table, op: "select", arg: cols });
              return {
                eq: () => ({ maybeSingle: () => Promise.resolve(mocks.usersSelect) }),
              };
            },
            update: (patch: Record<string, unknown>) => {
              mocks.calls.push({ table, op: "update", arg: patch });
              return { eq: () => Promise.resolve(mocks.usersUpdate) };
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
    identity: { userId: ATHLETE, resource: "https://example.com/api/mcp" },
  }),
}));

type ToolHandler = (args: Record<string, unknown>, extra: unknown) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

class FakeServer {
  handlers = new Map<string, ToolHandler>();
  registerTool(name: string, _config: unknown, handler: ToolHandler): void {
    this.handlers.set(name, handler);
  }
}

async function callTool(server: FakeServer, name: string, args: Record<string, unknown>) {
  const handler = server.handlers.get(name);
  if (!handler) throw new Error(`tool ${name} not registered`);
  const result = await handler(args, {});
  return { ...result, json: JSON.parse(result.content[0].text) };
}

beforeEach(async () => {
  vi.resetModules();
  mocks.profileSelect = { data: null, error: null };
  mocks.profileUpdate = { data: null, error: null };
  mocks.usersSelect = { data: { timezone: "UTC" }, error: null };
  mocks.usersUpdate = { error: null };
  mocks.calls = [];
});

async function buildServer(): Promise<FakeServer> {
  const { registerAllTools } = await import("../tools");
  const server = new FakeServer();
  registerAllTools(server as unknown as Parameters<typeof registerAllTools>[0]);
  return server;
}

describe("profile_get", () => {
  it("includes timezone from users alongside athlete_profiles fields", async () => {
    mocks.profileSelect = { data: { manual_fields: { age: 30 } } as unknown as { manual_fields: unknown }, error: null };
    mocks.usersSelect = { data: { timezone: "Asia/Calcutta" }, error: null };
    const server = await buildServer();
    const { json } = await callTool(server, "profile_get", {});
    expect(json).toEqual({ manual_fields: { age: 30 }, timezone: "Asia/Calcutta" });
  });

  it("defaults timezone to UTC when the stored value is null", async () => {
    mocks.usersSelect = { data: { timezone: null }, error: null };
    const server = await buildServer();
    const { json } = await callTool(server, "profile_get", {});
    expect(json.timezone).toBe("UTC");
  });
});

describe("profile_update", () => {
  it("rejects an unrecognized timezone without writing to either table", async () => {
    const server = await buildServer();
    const { json, isError } = await callTool(server, "profile_update", { timezone: "Not/A_Real_Zone" });
    expect(isError).toBe(true);
    expect(json.error).toBe("invalid_input");
    expect(mocks.calls).toHaveLength(0);
  });

  it("rejects a syntactically-valid but non-canonical offset string (matches the REST route's validator)", async () => {
    const server = await buildServer();
    const { isError } = await callTool(server, "profile_update", { timezone: "+05:30" });
    expect(isError).toBe(true);
    expect(mocks.calls).toHaveLength(0);
  });

  it("updates only users.timezone when no manual-field args are given", async () => {
    const server = await buildServer();
    const { json, isError } = await callTool(server, "profile_update", { timezone: "Asia/Kolkata" });
    expect(isError).toBeUndefined();
    expect(json).toEqual({ timezone: "Asia/Kolkata" });
    expect(mocks.calls).toEqual([
      { table: "users", op: "update", arg: { timezone: "Asia/Kolkata" } },
    ]);
  });

  it("updates only athlete_profiles when no timezone is given, unchanged from prior behavior", async () => {
    mocks.profileSelect = { data: { manual_fields: {} }, error: null };
    mocks.profileUpdate = { data: { manual_fields: { age: 31 }, updated_at: "now" }, error: null };
    const server = await buildServer();
    const { json, isError } = await callTool(server, "profile_update", { age: 31 });
    expect(isError).toBeUndefined();
    expect(json).toEqual({ manual_fields: { age: 31 }, updated_at: "now" });
    expect(mocks.calls.map((c) => c.table)).toEqual(["athlete_profiles", "athlete_profiles"]);
  });

  it("updates both athlete_profiles and users.timezone when both are given", async () => {
    mocks.profileSelect = { data: { manual_fields: {} }, error: null };
    mocks.profileUpdate = { data: { manual_fields: { age: 31 }, updated_at: "now" }, error: null };
    const server = await buildServer();
    const { json, isError } = await callTool(server, "profile_update", {
      age: 31,
      timezone: "America/Los_Angeles",
    });
    expect(isError).toBeUndefined();
    expect(json).toEqual({ manual_fields: { age: 31 }, updated_at: "now", timezone: "America/Los_Angeles" });
    expect(mocks.calls.map((c) => `${c.table}:${c.op}`)).toEqual([
      "athlete_profiles:select",
      "athlete_profiles:update",
      "users:update",
    ]);
  });

  it("rejects a call with no fields at all", async () => {
    const server = await buildServer();
    const { isError, json } = await callTool(server, "profile_update", {});
    expect(isError).toBe(true);
    expect(json.error).toBe("invalid_input");
    expect(mocks.calls).toHaveLength(0);
  });
});
