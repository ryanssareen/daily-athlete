// Runtime content gate on persisted LLM free-text (rationale, narrative,
// workout descriptions). The eval harness checks the same rule offline, but
// evals never see real adversarial athlete input — so this gate runs at
// generation time, before persist, as defense alongside input delimiting and
// plain-text rendering.
//
// A failed check is a HARD REJECT (the generator returns `infeasible`, it does
// NOT regenerate): a medical directive or injection echo signals
// adversarial/systematically-broken output that retries won't fix, and a clean
// failure keeps the per-request model-call ceiling intact.
//
// This is a heuristic, not a guarantee. It is one layer: the model is also
// instructed never to give medical advice, free-text is delimited as data in
// the prompt, and all output renders as plain text (no HTML/markdown).

import type { GeneratedPlan } from "@da2/shared";

// No-medical-claims: the product makes no diagnostic/medical statements.
const MEDICAL_PATTERNS: RegExp[] = [
  /\bibuprofen\b/i,
  /\bpainkillers?\b/i,
  /\bcortisone\b/i,
  /\bprescription\b/i,
  /\bmedication\b/i,
  /\bdiagnos/i, // diagnose / diagnosis / diagnostic
  /run through (the )?pain/i,
  /\bpush through (the )?(injury|pain)\b/i,
];

// Prompt-injection / forged-authority echoes that must never reach a persisted,
// athlete-visible string.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |the )?(previous|prior|above) instructions/i,
  /system prompt/i,
  /\byou are now\b/i,
  /\bdisregard (the )?(rules|instructions)\b/i,
];

export interface ContentCheckResult {
  ok: boolean;
  /** Why it was rejected (for logging/regeneration decisions; not athlete-facing). */
  reason?: string;
}

const ALL_PATTERNS = [...MEDICAL_PATTERNS, ...INJECTION_PATTERNS];

/** Check a single free-text string. */
export function checkContent(text: string): ContentCheckResult {
  for (const pattern of ALL_PATTERNS) {
    if (pattern.test(text)) {
      return { ok: false, reason: `content matched disallowed pattern ${pattern}` };
    }
  }
  return { ok: true };
}

/** Check every persisted free-text field in a generated plan. */
export function checkPlanContent(plan: GeneratedPlan): ContentCheckResult {
  const fields: string[] = [];
  if (plan.narrative) fields.push(plan.narrative);
  for (const w of plan.workouts) {
    fields.push(w.rationale);
    if (w.structure.description) fields.push(w.structure.description);
  }
  for (const text of fields) {
    const r = checkContent(text);
    if (!r.ok) return r;
  }
  return { ok: true };
}
