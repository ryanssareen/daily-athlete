import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PlanViewSchema } from "../plan-view";

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "../../test-fixtures/plan-view-sample.json"), "utf8"),
) as Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("PlanViewSchema", () => {
  it("parses the shared fixture and round-trips it", () => {
    const parsed = PlanViewSchema.parse(fixture);
    expect(PlanViewSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it("accepts a view with no verdicts, null phases and an unavailable forecast", () => {
    const view = clone(fixture) as Record<string, any>;
    view.forecast = { status: "unavailable-no-data" };
    view.weeks[0].sessions[0].verdict = null;
    view.weeks[0].phase = null;
    view.sectionErrors = ["verdicts"];
    expect(() => PlanViewSchema.parse(view)).not.toThrow();
  });

  it("accepts the finished-block forecast state", () => {
    const view = clone(fixture) as Record<string, any>;
    view.forecast = { status: "unavailable-complete" };
    expect(() => PlanViewSchema.parse(view)).not.toThrow();
  });

  it("rejects an unknown verdict code", () => {
    const view = clone(fixture) as Record<string, any>;
    view.weeks[0].sessions[0].verdict = { code: "fully_crushed_it", headline: "x" };
    expect(() => PlanViewSchema.parse(view)).toThrow();
  });

  it("rejects a negative duration", () => {
    const view = clone(fixture) as Record<string, any>;
    view.weeks[0].plannedSeconds = -1;
    expect(() => PlanViewSchema.parse(view)).toThrow();
  });

  it("rejects an unknown extra key", () => {
    const view = clone(fixture) as Record<string, any>;
    view.surprise = true;
    expect(() => PlanViewSchema.parse(view)).toThrow();
  });

  it("rejects an unknown section error name", () => {
    const view = clone(fixture) as Record<string, any>;
    view.sectionErrors = ["story"];
    expect(() => PlanViewSchema.parse(view)).toThrow();
  });

  it("rejects a story with more than three paragraphs", () => {
    const view = clone(fixture) as Record<string, any>;
    view.story.paragraphs = ["a", "b", "c", "d"];
    expect(() => PlanViewSchema.parse(view)).toThrow();
  });
});
