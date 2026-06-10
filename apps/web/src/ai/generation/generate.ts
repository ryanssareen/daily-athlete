// Plan generation orchestrator: feasibility gate -> structured model call (with
// parse-retry) -> content gate (hard reject) -> whole-plan safety validation
// (regenerate-with-feedback) -> ok | infeasible.
//
// A hard global model-call ceiling bounds cost-DoS regardless of which retry
// layer fires. Rate-limit / transient client errors PROPAGATE so the Inngest
// worker maps them to RetryAfterError instead of burning the ceiling.

import {
  GeneratedPlanSchema,
  type GeneratePlanInput,
  type GeneratedPlan,
} from "@da2/shared";

import { isLlmBackOff, type LlmClient } from "@/llm";

import { checkPlanContent } from "./content-gate";
import type { GenerationContext } from "./context";
import { assessFeasibility } from "./feasibility";
import { buildGenerationPrompt } from "./prompts/generate-plan";
import { validateGeneratedPlan } from "./validate-plan";

export type GenerateResult =
  | { status: "ok"; plan: GeneratedPlan }
  | { status: "infeasible"; reason: string };

// Attempts per structured call to recover from malformed JSON (feeds the Zod
// error back). Regenerations to recover from an UNSAFE-but-valid plan (feeds the
// violation back). The global ceiling caps total spend across both loops.
export const MAX_PARSE_ATTEMPTS = 3;
export const MAX_REGEN_ATTEMPTS = 2;
export const MAX_MODEL_CALLS = 15;

const RETRY_MSG = "We couldn't generate a plan right now. Please try again.";
const SAFETY_MSG =
  "We couldn't build a plan within safe training limits for this goal.";

export interface GenerateDeps {
  client: LlmClient;
  /** Today's date (YYYY-MM-DD), injected for deterministic feasibility. */
  today: string;
}

export async function generate(
  input: GeneratePlanInput,
  ctx: GenerationContext,
  deps: GenerateDeps
): Promise<GenerateResult> {
  const feasibility = assessFeasibility(input, deps.today);
  if (!feasibility.feasible) {
    return { status: "infeasible", reason: feasibility.reason ?? SAFETY_MSG };
  }

  let calls = 0;
  let violationFeedback: string | undefined;

  for (let regen = 0; regen <= MAX_REGEN_ATTEMPTS; regen++) {
    let priorError: string | undefined;
    let plan: GeneratedPlan | undefined;

    for (let attempt = 0; attempt < MAX_PARSE_ATTEMPTS; attempt++) {
      if (calls >= MAX_MODEL_CALLS) return { status: "infeasible", reason: RETRY_MSG };
      calls++;
      const { system, prompt } = buildGenerationPrompt(input, ctx, {
        priorError,
        violationFeedback,
      });
      let raw: unknown;
      try {
        const result = await deps.client.generateStructured({
          system,
          prompt,
          schema: GeneratedPlanSchema,
          traceName: "generate.plan",
        });
        raw = result.json;
      } catch (err) {
        // Back-off cases propagate; the worker turns them into RetryAfterError.
        if (isLlmBackOff(err)) throw err;
        priorError = err instanceof Error ? err.message : "invalid model output";
        continue;
      }
      const parsed = GeneratedPlanSchema.safeParse(raw);
      if (!parsed.success) {
        priorError = parsed.error.issues[0]?.message ?? "invalid plan shape";
        continue;
      }
      plan = parsed.data;
      break;
    }

    if (!plan) return { status: "infeasible", reason: RETRY_MSG };

    // Content gate is a HARD reject — no regeneration (a medical/injection echo
    // signals adversarial/broken output retries won't fix).
    if (!checkPlanContent(plan).ok) {
      return { status: "infeasible", reason: RETRY_MSG };
    }

    const validation = validateGeneratedPlan(plan, ctx.load);
    if (validation.valid) return { status: "ok", plan };
    violationFeedback = validation.violations.map((v) => v.detail).join("; ");
  }

  return { status: "infeasible", reason: SAFETY_MSG };
}
