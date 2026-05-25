import { beforeEach, describe, expect, it } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { EditOp } from "@da2/shared";

import { runEngine } from "@/ai/adaptive/engine";
import { FixtureProposer } from "@/ai/adaptive/llm";
import { ProposeError } from "@/ai/adaptive/propose";
import {
  FIXTURE_ATHLETE_ID,
  FIXTURE_PLAN_ID,
  FIXTURE_WORKOUT_IDS,
  fixtureCompletedWorkouts,
  fixturePlannedWorkouts,
} from "@/ai/adaptive/__fixtures__/structure";

const ASOF = "2026-05-25";

// ---------------------------------------------------------------------------
// Configurable fake admin client.
//
// Serves the gatherContext reads (plans / planned_workouts / completed_workouts
// / athlete_profiles), the open-proposal precedence read (weekly_reviews
// maybeSingle), the propose_weekly_review RPC, and the direct-insert paths
// (no_changes / workout-scoped). Captures the RPC + insert for assertions.
// ---------------------------------------------------------------------------

interface FakeConfig {
  /** Existing pending plan-scoped proposal's trigger_kind, or null. */
  pendingTriggerKind: string | null;
  /** Whether an active plan exists. */
  hasActivePlan: boolean;
  /** event_date on the active plan. */
  eventDate: string | null;
  plannedRows: Record<string, unknown>[];
  completedRows: { started_at: string; duration_s: number | null; summary_stats: unknown }[];
  /** RPC return (the new id, or null when suppressed) / error. */
  rpcResult: { data: unknown; error: { message: string; code?: string } | null };
}

interface FakeCaptures {
  rpcName: string | null;
  rpcArgs: Record<string, unknown> | null;
  insertTable: string | null;
  insertRow: Record<string, unknown> | null;
}

function makeAdmin(cfg: FakeConfig, cap: FakeCaptures): SupabaseClient {
  function selectBuilder(table: string) {
    // A chainable builder that records nothing; resolves on maybeSingle/await.
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    for (const m of ["select", "eq", "is"]) builder[m] = chain;

    builder.maybeSingle = () => {
      if (table === "plans") {
        return Promise.resolve({
          data: cfg.hasActivePlan
            ? { id: FIXTURE_PLAN_ID, event_date: cfg.eventDate }
            : null,
          error: null,
        });
      }
      if (table === "athlete_profiles") {
        return Promise.resolve({ data: { manual_fields: {} }, error: null });
      }
      if (table === "weekly_reviews") {
        return Promise.resolve({
          data: cfg.pendingTriggerKind
            ? { id: "pending-id", trigger_kind: cfg.pendingTriggerKind }
            : null,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };

    // planned_workouts / completed_workouts are awaited directly (no maybeSingle).
    builder.then = (resolve: (v: unknown) => unknown) => {
      if (table === "planned_workouts") {
        return resolve({ data: cfg.plannedRows, error: null });
      }
      if (table === "completed_workouts") {
        return resolve({ data: cfg.completedRows, error: null });
      }
      return resolve({ data: [], error: null });
    };
    return builder;
  }

  return {
    rpc(name: string, args: Record<string, unknown>) {
      cap.rpcName = name;
      cap.rpcArgs = args;
      return Promise.resolve(cfg.rpcResult);
    },
    from(table: string) {
      return {
        select: () => selectBuilder(table),
        insert(row: Record<string, unknown>) {
          cap.insertTable = table;
          cap.insertRow = row;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "direct-insert-id" }, error: null }),
            }),
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

function defaultConfig(over: Partial<FakeConfig> = {}): FakeConfig {
  // planned_workouts rows in the raw DB shape (structure JSONB + version).
  const plannedRows = fixturePlannedWorkouts().map((w) => ({
    id: w.id,
    scheduled_date: w.scheduled_date,
    sport: w.sport,
    structure: w.structure,
    planned_load: w.planned_load,
    status: w.status,
    version: w.version,
    edited_by_kind: w.edited_by_kind,
    edited_at: w.edited_at,
  }));
  return {
    pendingTriggerKind: null,
    hasActivePlan: true,
    eventDate: "2026-09-01",
    plannedRows,
    completedRows: fixtureCompletedWorkouts(ASOF).map((c) => ({
      started_at: c.started_at,
      duration_s: c.duration_s,
      summary_stats: c.summary_stats,
    })),
    rpcResult: { data: "engine-review-id", error: null },
    ...over,
  };
}

function emptyCaptures(): FakeCaptures {
  return { rpcName: null, rpcArgs: null, insertTable: null, insertRow: null };
}

// A safe deload op (cut the tempo run) — passes the validator.
function safeDeloadOp(): EditOp {
  return {
    op_id: "op-deload",
    kind: "modify",
    workout_id: FIXTURE_WORKOUT_IDS.tempoRun,
    changes: { duration_s: 1800, load: 30 },
    reason: "ease back this week",
  };
}

// An op targeting the coach-edited row — the validator must drop it.
function coachTargetedOp(): EditOp {
  return {
    op_id: "op-coach",
    kind: "modify",
    workout_id: FIXTURE_WORKOUT_IDS.coachEdited,
    changes: { duration_s: 1800, load: 30 },
    reason: "trim this",
  };
}

// An op that breaches the weekly-volume ramp (huge insert in a populated week).
function unsafeRampOp(): EditOp {
  return {
    op_id: "op-ramp",
    kind: "insert",
    on_date: "2026-06-02", // same ISO week as the easy/tempo runs
    sport: "run",
    structure: { duration_s: 36000, load: 400 },
    reason: "add a massive session",
  };
}

let cap: FakeCaptures;
beforeEach(() => {
  cap = emptyCaptures();
});

describe("runEngine — happy path", () => {
  it("persists a proposed row with validated ops + {version} baselines", async () => {
    const cfg = defaultConfig();
    const admin = makeAdmin(cfg, cap);
    const proposer = new FixtureProposer({ ops: [safeDeloadOp()] });

    const res = await runEngine({
      admin,
      athleteId: FIXTURE_ATHLETE_ID,
      triggerKind: "weekly",
      scope: "plan",
      recipient: "athlete",
      proposer,
      asOf: ASOF,
    });

    expect(res.outcome).toBe("proposed");
    expect(res.reviewId).toBe("engine-review-id");
    expect(res.opCount).toBe(1);
    expect(res.droppedCount).toBe(0);

    // Went through the precedence RPC with a {version} baseline attached.
    expect(cap.rpcName).toBe("propose_weekly_review");
    const changes = cap.rpcArgs?.p_proposed_changes as { op: EditOp; baseline: unknown }[];
    expect(changes).toHaveLength(1);
    expect(changes[0].op.op_id).toBe("op-deload");
    // tempoRun fixture has version 2.
    expect(changes[0].baseline).toEqual({ version: 2, status: "planned" });
    // Narrative respected.
    expect(typeof cap.rpcArgs?.p_narrative).toBe("string");
  });
});

describe("runEngine — all ops dropped / empty diff", () => {
  it("persists a no_changes row (direct insert, no RPC) when every op breaches an invariant", async () => {
    const cfg = defaultConfig();
    const admin = makeAdmin(cfg, cap);
    const proposer = new FixtureProposer({ ops: [unsafeRampOp()] });

    const res = await runEngine({
      admin,
      athleteId: FIXTURE_ATHLETE_ID,
      triggerKind: "weekly",
      scope: "plan",
      recipient: "athlete",
      proposer,
      asOf: ASOF,
    });

    expect(res.outcome).toBe("no_changes");
    expect(res.opCount).toBe(0);
    expect(res.droppedCount).toBe(1);
    // no_changes must NOT route through the precedence RPC.
    expect(cap.rpcName).toBeNull();
    expect(cap.insertTable).toBe("weekly_reviews");
    expect(cap.insertRow?.status).toBe("no_changes");
  });

  it("persists no_changes when the proposer returns an empty diff", async () => {
    const admin = makeAdmin(defaultConfig(), cap);
    const proposer = new FixtureProposer({ ops: [] });
    const res = await runEngine({
      admin,
      athleteId: FIXTURE_ATHLETE_ID,
      triggerKind: "weekly",
      scope: "plan",
      recipient: "athlete",
      proposer,
      asOf: ASOF,
    });
    expect(res.outcome).toBe("no_changes");
    expect(cap.rpcName).toBeNull();
  });
});

describe("runEngine — coach-edited exclusion (integration)", () => {
  it("excludes a coach-edited workout from the proposed ops, keeping the safe one", async () => {
    const admin = makeAdmin(defaultConfig(), cap);
    const proposer = new FixtureProposer({ ops: [safeDeloadOp(), coachTargetedOp()] });

    const res = await runEngine({
      admin,
      athleteId: FIXTURE_ATHLETE_ID,
      triggerKind: "weekly",
      scope: "plan",
      recipient: "athlete",
      proposer,
      asOf: ASOF,
    });

    expect(res.outcome).toBe("proposed");
    expect(res.opCount).toBe(1);
    expect(res.droppedCount).toBe(1);
    const changes = cap.rpcArgs?.p_proposed_changes as { op: EditOp }[];
    expect(changes.map((c) => c.op.op_id)).toEqual(["op-deload"]);
  });
});

describe("runEngine — retry path produces exactly one proposed row", () => {
  it("retries invalid output then persists once (no partial writes)", async () => {
    const admin = makeAdmin(defaultConfig(), cap);
    const proposer = new FixtureProposer({
      script: [["garbage"], [{ op_id: "x", kind: "modify" }], [safeDeloadOp()]],
    });

    const res = await runEngine({
      admin,
      athleteId: FIXTURE_ATHLETE_ID,
      triggerKind: "weekly",
      scope: "plan",
      recipient: "athlete",
      proposer,
      asOf: ASOF,
    });

    expect(res.outcome).toBe("proposed");
    expect(res.opCount).toBe(1);
    expect(proposer.calls).toBe(3);
  });
});

describe("runEngine — proposer fails all retries", () => {
  it("throws ProposeError and writes NO row", async () => {
    const admin = makeAdmin(defaultConfig(), cap);
    const proposer = new FixtureProposer({ failWith: new Error("provider down") });

    await expect(
      runEngine({
        admin,
        athleteId: FIXTURE_ATHLETE_ID,
        triggerKind: "weekly",
        scope: "plan",
        recipient: "athlete",
        proposer,
        asOf: ASOF,
      })
    ).rejects.toBeInstanceOf(ProposeError);

    expect(cap.rpcName).toBeNull();
    expect(cap.insertTable).toBeNull();
  });
});

describe("runEngine — precedence", () => {
  it("suppresses BEFORE generation when a higher-priority proposal is pending", async () => {
    const cfg = defaultConfig({ pendingTriggerKind: "event_change" });
    const admin = makeAdmin(cfg, cap);
    const proposer = new FixtureProposer({ ops: [safeDeloadOp()] });

    const res = await runEngine({
      admin,
      athleteId: FIXTURE_ATHLETE_ID,
      triggerKind: "weekly", // lower than pending event_change
      scope: "plan",
      recipient: "athlete",
      proposer,
      asOf: ASOF,
    });

    expect(res.outcome).toBe("suppressed_pre_generation");
    // No LLM call, no writes.
    expect(proposer.calls).toBe(0);
    expect(cap.rpcName).toBeNull();
    expect(cap.insertTable).toBeNull();
  });

  it("proceeds (and supersedes via RPC) when incoming is higher than pending", async () => {
    const cfg = defaultConfig({ pendingTriggerKind: "weekly" });
    const admin = makeAdmin(cfg, cap);
    const proposer = new FixtureProposer({ ops: [safeDeloadOp()] });

    const res = await runEngine({
      admin,
      athleteId: FIXTURE_ATHLETE_ID,
      triggerKind: "event_change", // higher than pending weekly
      scope: "plan",
      recipient: "athlete",
      proposer,
      asOf: ASOF,
    });

    expect(res.outcome).toBe("proposed");
    expect(proposer.calls).toBe(1);
    expect(cap.rpcName).toBe("propose_weekly_review");
  });

  it("returns lost_race when the RPC raises a 23505 at commit", async () => {
    const cfg = defaultConfig({
      rpcResult: { data: null, error: { message: "dup", code: "23505" } },
    });
    const admin = makeAdmin(cfg, cap);
    const proposer = new FixtureProposer({ ops: [safeDeloadOp()] });

    const res = await runEngine({
      admin,
      athleteId: FIXTURE_ATHLETE_ID,
      triggerKind: "event_change",
      scope: "plan",
      recipient: "athlete",
      proposer,
      asOf: ASOF,
    });

    expect(res.outcome).toBe("lost_race");
    expect(res.opCount).toBe(0);
  });
});

describe("runEngine — no active plan", () => {
  it("returns no_active_plan without calling the proposer", async () => {
    const cfg = defaultConfig({ hasActivePlan: false });
    const admin = makeAdmin(cfg, cap);
    const proposer = new FixtureProposer({ ops: [safeDeloadOp()] });

    const res = await runEngine({
      admin,
      athleteId: FIXTURE_ATHLETE_ID,
      triggerKind: "weekly",
      scope: "plan",
      recipient: "athlete",
      proposer,
      asOf: ASOF,
    });

    expect(res.outcome).toBe("no_active_plan");
    expect(proposer.calls).toBe(0);
  });
});
