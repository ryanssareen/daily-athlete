# AI plan generation evals (R8)

The product wins or loses on AI plan quality, so generation ships behind a
measurable quality gate. Two tiers:

## 1. Deterministic gate — hard, blocking

`src/ai/eval/deterministic.ts` (`scorePlanDeterministic`) scores a candidate
`GeneratedPlan` against the **same safety thresholds the apply path enforces** —
it calls `validateGeneratedPlan` (load-trajectory safety) and `checkPlanContent`
(no medical claims) plus structural periodization checks. So "safe" means the
identical magnitudes at eval, generation, and apply time.

This needs no model and no coaches. It runs as a normal vitest suite
(`pnpm --filter @da2/web exec vitest run src/ai/eval`) and is the **blocking**
CI gate (`.github/workflows/evals.yml`).

## 2. LLM-as-judge — soft, subjective

`src/ai/eval/judge.ts` (`judgePlan`) grades athlete-appropriateness, structural
quality, and narrative coherence against **coach-graded reference plans**, via
the shared LLM client. It needs a live model and a reference corpus.

- **Reference corpus** (`fixtures/reference_plans/`) starts as a small,
  internally-graded seed and **grows with the alpha coaches**. The judge is the
  launch-quality bar for the core wedge; track corpus growth as a launch
  dependency, not open-ended work.
- Runs only when `ANTHROPIC_API_KEY` is configured (does not block today).

## Layout

```
evals/
  promptfooconfig.yaml         # promptfoo harness (live judge run)
  fixtures/
    athletes/                  # GeneratePlanInput scenarios (beginner, injury, time-crunched, tri)
    reference_plans/           # coach-graded GeneratedPlan references (seed; grows with alpha)
```

The scoring logic lives under `src/ai/eval/` (aliased + vitest-covered); the
promptfoo harness here is a thin shim over it, so the gate logic is unit-tested
rather than trapped in promptfoo's runner context.
