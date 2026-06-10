# Coach-graded reference plans

The LLM-as-judge scores candidate plans against these. Each file is a
coach-approved `GeneratedPlan` for a scenario in `../athletes/`, named to match
(e.g. `beginner.json`).

This corpus starts as a small, internally-graded seed and **grows with the alpha
coaches** — it is the launch-quality bar for the wedge, so treat reaching a
meaningful corpus size as a launch dependency. Until then the judge runs against
the seed and is non-blocking; the deterministic gate (`src/ai/eval`) is the
blocking check.

Add a reference by dropping a `GeneratedPlan` JSON here with the same basename as
its athlete fixture.
