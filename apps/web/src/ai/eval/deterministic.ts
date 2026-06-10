// Deterministic eval scoring — the HARD quality gate (R8).
//
// Needs no coaches and no live model: scores a candidate GeneratedPlan against
// the SAME safety thresholds the apply path enforces (validateGeneratedPlan +
// checkPlanContent) plus structural periodization rules. So "safe" means the
// identical magnitudes at eval, generation, and apply time. The LLM-as-judge
// (judge.ts) layers subjective quality on top; THIS is the blocking gate.
//
// Lives under src/ (aliased + vitest-covered) and is wrapped by the promptfoo
// harness in apps/web/evals — resolving the "promptfoo runs in its own Node
// context" caveat by keeping the logic in app code with a thin harness shim.

import type { GeneratedPlan } from "@da2/shared";

import { checkPlanContent } from "@/ai/generation/content-gate";
import {
  validateGeneratedPlan,
  type PlanLoadContext,
} from "@/ai/generation/validate-plan";

export const PASS_BAR = 0.8;

export interface DeterministicCheck {
  name: string;
  passed: boolean;
  mandatory: boolean;
  detail?: string;
}

export interface DeterministicScore {
  checks: DeterministicCheck[];
  passed: number;
  total: number;
  score: number;
  /** Overall gate: every mandatory check passes AND score >= PASS_BAR. */
  ok: boolean;
}

export function scorePlanDeterministic(
  plan: GeneratedPlan,
  ctx: PlanLoadContext
): DeterministicScore {
  const checks: DeterministicCheck[] = [];

  // Mandatory: load safety (same validator as apply time).
  const safety = validateGeneratedPlan(plan, ctx);
  checks.push({
    name: "load_safety",
    passed: safety.valid,
    mandatory: true,
    detail: safety.violations.map((v) => v.code).join(", ") || undefined,
  });

  // Mandatory: no medical claims / injected content.
  const content = checkPlanContent(plan);
  checks.push({
    name: "no_medical_claims",
    passed: content.ok,
    mandatory: true,
    detail: content.reason,
  });

  // Every workout is phase-tagged and carries a rationale (R7).
  checks.push({
    name: "workouts_tagged",
    passed: plan.workouts.every(
      (w) => Boolean(w.structure.phase) && w.rationale.trim().length > 0
    ),
    mandatory: false,
  });

  // Periodized: at least two distinct block phases.
  const phases = new Set(plan.workouts.map((w) => w.structure.phase));
  checks.push({ name: "periodized", passed: phases.size >= 2, mandatory: false });

  // Taper present when there is an event.
  if (plan.event_date) {
    checks.push({
      name: "taper_present",
      passed: plan.workouts.some((w) => w.structure.phase === "taper"),
      mandatory: false,
    });
  }

  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  const score = total > 0 ? passed / total : 0;
  const mandatoryOk = checks.every((c) => !c.mandatory || c.passed);
  return { checks, passed, total, score, ok: mandatoryOk && score >= PASS_BAR };
}
