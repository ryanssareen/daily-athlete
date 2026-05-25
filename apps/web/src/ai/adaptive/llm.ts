// The LLM diff-proposer boundary for the AI adaptive engine.
//
// The engine asks a proposer for a set of EditOps (a diff against the existing
// plan — NEVER a regenerated plan). The proposer is an interface so the real
// Langfuse-traced client can be swapped in without touching the engine:
//
//   TODO: wire the real Langfuse-traced client when product Unit 3.2 lands
//   (apps/web/src/ai/llm). It does NOT exist yet; until then the engine runs
//   against the deterministic FixtureProposer below so the whole pipeline is
//   testable without the live model.
//
// The proposer returns *unvalidated, unparsed* candidates: propose.ts is the
// boundary that safeParses each one against EditOpSchema and retries (<=3) on
// invalid output, feeding the validation error back. The deterministic
// validator (Unit 4) then drops any safe-but-unsafe op. The proposer is never
// trusted to self-validate.

import type { EditOp, TriggerKind } from "@da2/shared";

import type { PlanContext } from "./context";

/** What the engine hands the proposer to generate a diff. */
export interface ProposeInput {
  /** Snapshotted plan + load + targeted-row context (see context.ts). */
  context: PlanContext;
  /** Which trigger fired (frames the LLM ask: weekly review, missed block, ...). */
  triggerKind: TriggerKind;
  /**
   * Optional feedback from a prior failed attempt: the Zod validation error
   * text, fed back so the model can correct its output. Undefined on attempt 1.
   */
  priorError?: string;
}

/**
 * The diff-proposer contract. `propose` returns candidate ops as `unknown[]` —
 * deliberately UNTYPED at this boundary because the real LLM may emit malformed
 * JSON; propose.ts owns parsing/validation. The FixtureProposer happens to
 * return well-formed EditOps, but callers must not rely on that type.
 */
export interface AdaptiveProposer {
  propose(input: ProposeInput): Promise<unknown[]>;
}

/**
 * Deterministic, canned proposer for tests and local dev. Returns a fixed list
 * of candidate ops per call. Configure via the constructor:
 *  - `ops`: the candidate list to return (well-formed EditOps by default).
 *  - `script`: a per-attempt list (index = attempt number) to exercise the
 *    retry path — e.g. invalid JSON on attempts 0,1 then valid on attempt 2.
 *  - `failWith`: throw on every call (the "proposer fails all retries" case).
 */
export class FixtureProposer implements AdaptiveProposer {
  private callCount = 0;

  constructor(
    private readonly opts: {
      ops?: EditOp[];
      script?: unknown[][];
      failWith?: Error;
    } = {}
  ) {}

  /** How many times propose() has been invoked (for retry-path assertions). */
  get calls(): number {
    return this.callCount;
  }

  async propose(_input: ProposeInput): Promise<unknown[]> {
    const attempt = this.callCount;
    this.callCount += 1;

    if (this.opts.failWith) {
      throw this.opts.failWith;
    }
    if (this.opts.script) {
      // Clamp to the last scripted attempt so an over-long retry loop is stable.
      const idx = Math.min(attempt, this.opts.script.length - 1);
      return this.opts.script[idx];
    }
    return this.opts.ops ?? [];
  }
}
