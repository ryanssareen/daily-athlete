// Unit tests for the on-demand adaptive-trigger helper (plan Unit 10).
//
// Pure-unit: the only dependency (the Inngest sender) is injected as a fake, so
// no client, queue, or env is needed. Validates:
//   - scope mapping (workout_swap → 'workout', else 'plan');
//   - the event name + payload shape matches ADAPTIVE_RUN_EVENT;
//   - dedup_key is unique per call (default UUID) so on-demand runs never dedupe;
//   - an injected dedup_key is honoured;
//   - sendOnDemandTrigger forwards to the injected sender and returns the payload;
//   - a throwing sender propagates (the route owns the best-effort posture).

import { describe, expect, it, vi } from "vitest";

import { ADAPTIVE_RUN_EVENT } from "@/inngest/functions/adaptive-run";
import {
  buildOnDemandEvent,
  scopeForTrigger,
  sendOnDemandTrigger,
  type OnDemandTriggerKind,
} from "../on-demand";

describe("scopeForTrigger", () => {
  it("maps workout_swap → 'workout'", () => {
    expect(scopeForTrigger("workout_swap")).toBe("workout");
  });

  it.each<OnDemandTriggerKind>(["manual", "schedule_shock", "event_change"])(
    "maps %s → 'plan'",
    (kind) => {
      expect(scopeForTrigger(kind)).toBe("plan");
    },
  );
});

describe("buildOnDemandEvent", () => {
  it("builds the ADAPTIVE_RUN_EVENT payload with correct name + data", () => {
    const ev = buildOnDemandEvent({
      athleteId: "athlete-1",
      triggerKind: "manual",
      dedupKey: "fixed-key",
    });
    expect(ev).toEqual({
      name: ADAPTIVE_RUN_EVENT,
      data: {
        athlete_id: "athlete-1",
        trigger_kind: "manual",
        scope: "plan",
        dedup_key: "fixed-key",
      },
    });
  });

  it("sets scope 'workout' for workout_swap", () => {
    const ev = buildOnDemandEvent({
      athleteId: "a",
      triggerKind: "workout_swap",
      dedupKey: "k",
    });
    expect(ev.data.scope).toBe("workout");
    expect(ev.data.trigger_kind).toBe("workout_swap");
  });

  it("generates a UNIQUE dedup_key by default (on-demand runs never dedupe)", () => {
    const a = buildOnDemandEvent({ athleteId: "x", triggerKind: "manual" });
    const b = buildOnDemandEvent({ athleteId: "x", triggerKind: "manual" });
    expect(a.data.dedup_key).toBeTruthy();
    expect(b.data.dedup_key).toBeTruthy();
    expect(a.data.dedup_key).not.toBe(b.data.dedup_key);
  });

  it("honours an injected dedup_key", () => {
    const ev = buildOnDemandEvent({
      athleteId: "x",
      triggerKind: "event_change",
      dedupKey: "deterministic",
    });
    expect(ev.data.dedup_key).toBe("deterministic");
  });
});

describe("sendOnDemandTrigger", () => {
  it("forwards the built payload to the injected sender and returns it", async () => {
    const send = vi.fn(async () => ({ ids: ["evt-1"] }));
    const payload = await sendOnDemandTrigger(send, {
      athleteId: "athlete-9",
      triggerKind: "schedule_shock",
      dedupKey: "key-9",
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(payload);
    expect(payload).toEqual({
      name: ADAPTIVE_RUN_EVENT,
      data: {
        athlete_id: "athlete-9",
        trigger_kind: "schedule_shock",
        scope: "plan",
        dedup_key: "key-9",
      },
    });
  });

  it("propagates a throwing sender (route owns best-effort posture)", async () => {
    const send = vi.fn(async () => {
      throw new Error("queue down");
    });
    await expect(
      sendOnDemandTrigger(send, { athleteId: "a", triggerKind: "manual" }),
    ).rejects.toThrow("queue down");
  });
});
