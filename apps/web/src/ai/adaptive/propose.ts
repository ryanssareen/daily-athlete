import "server-only";

// propose.ts — the parse/validate/retry boundary between the (untrusted) LLM
// diff-proposer and the engine.
//
// The proposer returns candidate ops as `unknown[]` (the real LLM can emit
// malformed JSON / off-schema objects). This module `safeParse`s EACH candidate
// against the canonical `EditOpSchema` and retries the WHOLE call up to
// MAX_ATTEMPTS, feeding the Zod error text back to the proposer so the model can
// correct itself. It NEVER regenerates the whole plan — only the edit diff.
//
// Contract:
//  - Success: returns a list of schema-valid EditOps (possibly empty — an empty
//    safe diff is a legitimate "no changes" outcome, handled by the engine).
//  - All attempts produced invalid output, or the proposer threw on every
//    attempt: throws ProposeError (a typed error the engine surfaces; NO row is
//    written by the engine in that case).

import { EditOpSchema, type EditOp, type TriggerKind } from "@da2/shared";

import type { AdaptiveProposer, ProposeInput } from "./llm";
import type { PlanContext } from "./context";

/** Max LLM attempts (1 initial + retries). Matches the plan's "<=3". */
export const MAX_ATTEMPTS = 3;

/** Thrown when the proposer never yields schema-valid output within the budget. */
export class ProposeError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ProposeError";
  }
}

export interface ProposeArgs {
  proposer: AdaptiveProposer;
  context: PlanContext;
  triggerKind: TriggerKind;
}

/**
 * Ask the proposer for an EditOp diff, parsing + retrying on invalid output.
 * Returns the parsed, schema-valid ops (the deterministic validator drops
 * safe-but-unsafe ones downstream). Throws ProposeError when the budget is
 * exhausted without valid output.
 */
export async function propose(args: ProposeArgs): Promise<EditOp[]> {
  const { proposer, context, triggerKind } = args;

  let priorError: string | undefined;
  let lastErrorDetail = "no attempts ran";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const input: ProposeInput = { context, triggerKind, priorError };

    let raw: unknown[];
    try {
      raw = await proposer.propose(input);
    } catch (err) {
      // A proposer that throws (network / provider error) consumes an attempt;
      // feed a short note back and retry.
      lastErrorDetail = err instanceof Error ? err.message : String(err);
      priorError = `proposer threw: ${lastErrorDetail}`;
      continue;
    }

    const { ops, error } = parseAll(raw);
    if (error == null) {
      return ops;
    }
    // Invalid output: feed the validation error back and retry.
    lastErrorDetail = error;
    priorError = error;
  }

  throw new ProposeError(
    `proposer failed to produce schema-valid ops within ${MAX_ATTEMPTS} attempts: ${lastErrorDetail}`
  );
}

/**
 * Parse a candidate list. Returns the parsed ops on full success, or an error
 * string describing the FIRST invalid candidate (fed back to the model). An
 * empty list parses successfully (a valid empty diff).
 */
function parseAll(raw: unknown[]): { ops: EditOp[]; error: string | null } {
  if (!Array.isArray(raw)) {
    return { ops: [], error: "expected an array of edit operations" };
  }
  const ops: EditOp[] = [];
  for (let i = 0; i < raw.length; i++) {
    const parsed = EditOpSchema.safeParse(raw[i]);
    if (!parsed.success) {
      return {
        ops: [],
        error: `op[${i}] invalid: ${parsed.error.issues
          .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
          .join("; ")}`,
      };
    }
    ops.push(parsed.data);
  }
  // Reject duplicate op_ids — they break per-op cherry-pick + result mapping.
  const seen = new Set<string>();
  for (const op of ops) {
    if (seen.has(op.op_id)) {
      return { ops: [], error: `duplicate op_id "${op.op_id}"` };
    }
    seen.add(op.op_id);
  }
  return { ops, error: null };
}
