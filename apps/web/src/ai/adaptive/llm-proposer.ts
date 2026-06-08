import "server-only";

// The real LLM-backed adaptive proposer (Unit 6) — replaces FixtureProposer.
//
// Implements the AdaptiveProposer boundary over the shared LlmClient: builds a
// per-trigger diff prompt, calls the model, and returns the RAW parsed JSON
// (`unknown[]`). It does NOT validate — propose.ts owns parse/retry against
// EditOpSchema, and the deterministic validator drops unsafe ops. Rate-limit /
// transient client errors propagate (propose.ts re-throws them so the worker
// backs off instead of burning retries).

import { z } from "zod";

import { EditOpSchema } from "@da2/shared";

import type { LlmClient } from "@/llm";

import type { PlanContext } from "./context";
import type { AdaptiveProposer, ProposeInput } from "./llm";
import { buildReplanPrompt } from "./prompts/replan";

// Soft provider-side hint only; propose.ts is the trust boundary.
const EditOpArraySchema = z.array(EditOpSchema);

export class LlmProposer implements AdaptiveProposer {
  constructor(private readonly client: LlmClient) {}

  async propose(input: ProposeInput): Promise<unknown[]> {
    const { system, prompt } = buildReplanPrompt(
      input.context as PlanContext,
      input.triggerKind,
      input.priorError
    );
    const result = await this.client.generateStructured({
      system,
      prompt,
      schema: EditOpArraySchema,
      traceName: `adaptive.${input.triggerKind}`,
    });
    // Hand back raw. If the model returned a non-array, parseAll reports
    // "expected an array" and propose.ts retries with that feedback.
    return result.json as unknown[];
  }
}
