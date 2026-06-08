// Non-blocking block-coherence check (Unit 8).
//
// The block=generation / workout=adaptation decision accepts that workout-level
// EditOps can decohere a block (e.g. the engine skips a build block's quality
// sessions -> a hollow "build"; or a key session moves into the taper). This
// makes that drift OBSERVABLE rather than silent. It is a PURE function and is
// NEVER a gate: it must not be added to validateEditOps and never rejects an op.
// `structure.phase` is authoritative at generation time only; this is the signal
// future block-replan/C4 build on.

import type { IntensityTarget, WorkoutPhase } from "@da2/shared";

export interface CoherenceWorkout {
  scheduled_date: string;
  phase: WorkoutPhase;
  intensity_target?: IntensityTarget;
}

export interface BlockCoherence {
  phase: WorkoutPhase;
  coherent: boolean;
  /** Why the block looks decohered (empty when coherent). */
  reasons: string[];
}

// Canonical periodization order. `maintenance` has no fixed position (open-ended
// plans), so it ranks with base for the monotonicity check.
const PHASE_RANK: Record<WorkoutPhase, number> = {
  base: 0,
  maintenance: 0,
  build: 1,
  peak: 2,
  taper: 3,
};

// A "quality"/hard session by intensity target. Pace targets are not classified
// (we can't tell hard from easy without the athlete's threshold here).
function isHard(it?: IntensityTarget): boolean {
  if (!it) return false;
  if (it.kind === "zone") return it.value >= 5;
  if (it.kind === "ftp_pct") return it.value >= 88;
  return false;
}

/**
 * Assess each phase-block in a plan. Returns one entry per phase present, in
 * canonical order. Non-blocking: callers surface this as a hint, never a gate.
 */
export function assessBlockCoherence(
  workouts: CoherenceWorkout[]
): BlockCoherence[] {
  if (workouts.length === 0) return [];

  const byDate = [...workouts].sort((a, b) =>
    a.scheduled_date < b.scheduled_date ? -1 : a.scheduled_date > b.scheduled_date ? 1 : 0
  );

  // Monotonicity: a workout whose phase rank is below the max rank already seen
  // (by date) is out of order — a later block has already begun.
  const outOfOrder = new Set<WorkoutPhase>();
  let maxRank = -1;
  for (const w of byDate) {
    const rank = PHASE_RANK[w.phase];
    if (rank < maxRank) outOfOrder.add(w.phase);
    else maxRank = rank;
  }

  const present = [...new Set(workouts.map((w) => w.phase))].sort(
    (a, b) => PHASE_RANK[a] - PHASE_RANK[b]
  );

  return present.map((phase) => {
    const inPhase = workouts.filter((w) => w.phase === phase);
    const reasons: string[] = [];

    if (phase === "taper" && inPhase.some((w) => isHard(w.intensity_target))) {
      reasons.push("taper block contains a hard session");
    }
    if (
      (phase === "build" || phase === "peak") &&
      !inPhase.some((w) => isHard(w.intensity_target))
    ) {
      reasons.push(`${phase} block has no quality (hard) sessions`);
    }
    if (outOfOrder.has(phase)) {
      reasons.push(`a ${phase} session is scheduled after a later block has begun`);
    }

    return { phase, coherent: reasons.length === 0, reasons };
  });
}
