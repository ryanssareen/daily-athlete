import { describe, expect, it } from "vitest";

import type { TriggerKind } from "@da2/shared";

import {
  decidePrecedence,
  isCoupled,
  triggerPriority,
} from "@/ai/adaptive/precedence";

// These priorities MUST mirror the SQL `trigger_priority` CASE in
// supabase/migrations/0023_propose_weekly_review_rpc.sql. If this table changes,
// 0023 must change too (and vice versa).
const EXPECTED_PRIORITY: Record<TriggerKind, number> = {
  event_change: 60,
  missed_block: 50,
  fatigue_deload: 40,
  weekly: 30,
  manual: 30,
  progression_bump: 20,
  workout_swap: 10,
  schedule_shock: 0, // SQL ELSE branch
};

describe("triggerPriority — mirrors SQL 0023", () => {
  it("matches the SQL trigger_priority CASE exactly", () => {
    for (const [kind, expected] of Object.entries(EXPECTED_PRIORITY)) {
      expect(triggerPriority(kind as TriggerKind)).toBe(expected);
    }
  });

  it("ranks the v1 active subset B4 > B2 > B1 > B7", () => {
    expect(triggerPriority("event_change")).toBeGreaterThan(
      triggerPriority("missed_block")
    );
    expect(triggerPriority("missed_block")).toBeGreaterThan(
      triggerPriority("weekly")
    );
    expect(triggerPriority("weekly")).toBeGreaterThan(
      triggerPriority("workout_swap")
    );
  });

  it("ranks manual equal to weekly", () => {
    expect(triggerPriority("manual")).toBe(triggerPriority("weekly"));
  });
});

describe("isCoupled", () => {
  it("treats every trigger EXCEPT workout_swap as coupled (all-or-nothing)", () => {
    const coupled: TriggerKind[] = [
      "weekly",
      "missed_block",
      "schedule_shock",
      "event_change",
      "fatigue_deload",
      "progression_bump",
      "manual",
    ];
    for (const k of coupled) expect(isCoupled(k)).toBe(true);
    expect(isCoupled("workout_swap")).toBe(false);
  });
});

describe("decidePrecedence", () => {
  it("inserts when nothing is pending", () => {
    expect(decidePrecedence("weekly", null)).toBe("insert");
    expect(decidePrecedence("workout_swap", null)).toBe("insert");
  });

  it("supersedes a lower-priority pending proposal", () => {
    // event_change (60) over a pending weekly (30).
    expect(decidePrecedence("event_change", "weekly")).toBe("supersede");
    // missed_block (50) over a pending weekly (30).
    expect(decidePrecedence("missed_block", "weekly")).toBe("supersede");
  });

  it("suppresses when incoming is strictly lower priority than pending", () => {
    // weekly (30) under a pending event_change (60).
    expect(decidePrecedence("weekly", "event_change")).toBe("suppress");
    // workout_swap (10) under a pending missed_block (50).
    expect(decidePrecedence("workout_swap", "missed_block")).toBe("suppress");
  });

  it("supersedes on a tie (incoming >= pending) — a fresher equal proposal wins", () => {
    expect(decidePrecedence("weekly", "weekly")).toBe("supersede");
    // manual ties with weekly.
    expect(decidePrecedence("manual", "weekly")).toBe("supersede");
    expect(decidePrecedence("weekly", "manual")).toBe("supersede");
  });
});
