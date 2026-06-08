// LLM-as-judge eval scoring (R8). Layers subjective quality —
// athlete-appropriateness, structural/periodization quality, narrative coherence
// — on top of the deterministic safety gate. Runs against coach-graded reference
// plans; needs a live model (and a reference corpus that grows with the alpha),
// so it is the SOFT half. The deterministic gate (deterministic.ts) is blocking.

import { z } from "zod";

import type { GeneratedPlan } from "@da2/shared";

import type { LlmClient } from "@/llm";

export const JudgeVerdictSchema = z.object({
  // 1 = "I would assign this to a real athlete with at most minor edits".
  score: z.number().min(0).max(1),
  notes: z.string().max(2000),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

export interface JudgeInput {
  plan: GeneratedPlan;
  /** A coach-graded reference plan for the same athlete/scenario, when available. */
  reference?: GeneratedPlan;
  /** Short athlete description for context. */
  athleteSummary?: string;
}

const SYSTEM = [
  `You are a head endurance coach grading an AI-generated training plan.`,
  `Judge athlete-appropriateness, periodization/structural quality, and narrative coherence.`,
  `Respond with ONLY JSON {"score": number 0..1, "notes": string}.`,
  `A score >= 0.8 means "I would assign this to a real athlete with at most minor edits".`,
  `Never include medical advice in your notes.`,
].join("\n");

export async function judgePlan(
  client: LlmClient,
  input: JudgeInput
): Promise<JudgeVerdict> {
  const prompt = [
    `Candidate plan:\n${JSON.stringify(input.plan)}`,
    input.reference ? `Reference coach plan:\n${JSON.stringify(input.reference)}` : "",
    input.athleteSummary ? `Athlete:\n${input.athleteSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await client.generateStructured({
    system: SYSTEM,
    prompt,
    schema: JudgeVerdictSchema,
    traceName: "eval.judge",
  });
  const parsed = JudgeVerdictSchema.safeParse(result.json);
  if (!parsed.success) {
    throw new Error(
      `judge returned an invalid verdict: ${parsed.error.issues[0]?.message ?? "bad shape"}`
    );
  }
  return parsed.data;
}
