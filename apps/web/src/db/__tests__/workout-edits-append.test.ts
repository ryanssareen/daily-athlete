// Pure-unit tests for appendWorkoutEdit (apps/web/src/db/workout-edits.ts).
//
// The append helper is the single writer of the append-only workout_edits audit
// log from the app layer (plan Unit 2). These tests mock the supabase-js admin
// client entirely — no real DB, no `supabase start` needed (Docker-free). The
// DB-backed RLS + immutability behavior is covered separately in
// src/db/__tests__/workout-edits.rls.test.ts (CI, Postgres).
//
// Scenarios:
//   - Inserts into workout_edits with the correct column mapping.
//   - weekly_review_id defaults to null when omitted (direct athlete/coach edit).
//   - weekly_review_id is forwarded when provided (ai_review path).
//   - Returns the new row id.
//   - Throws on a Supabase error (so callers can surface the audit gap).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { appendWorkoutEdit } from "../workout-edits";

// ---------------------------------------------------------------------------
// Mock state + fake admin client
// ---------------------------------------------------------------------------

const mocks = {
  lastTable: null as string | null,
  lastInsertedRow: null as Record<string, unknown> | null,
  // The { data, error } returned from .single().
  nextResult: null as {
    data: { id: string } | null;
    error: { message: string; code?: string } | null;
  } | null,
};

function makeAdminFake() {
  return {
    from(table: string) {
      mocks.lastTable = table;
      return {
        insert(row: Record<string, unknown>) {
          mocks.lastInsertedRow = row;
          return {
            select() {
              return {
                async single() {
                  return (
                    mocks.nextResult ?? {
                      data: { id: "we-new-uuid" },
                      error: null,
                    }
                  );
                },
              };
            },
          };
        },
      };
    },
  };
}

// appendWorkoutEdit takes the admin client as an argument, so we just pass the
// fake. The `as never` cast keeps the SupabaseClient type happy for the fake.
function admin() {
  return makeAdminFake() as never;
}

beforeEach(() => {
  mocks.lastTable = null;
  mocks.lastInsertedRow = null;
  mocks.nextResult = null;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("appendWorkoutEdit", () => {
  it("inserts into the workout_edits table", async () => {
    await appendWorkoutEdit({
      admin: admin(),
      athleteId: "athlete-1",
      plannedWorkoutId: "pw-1",
      actorRole: "athlete",
      actorUserId: "athlete-1",
      fieldDiff: { status: { from: "planned", to: "moved" } },
    });
    expect(mocks.lastTable).toBe("workout_edits");
  });

  it("maps every column correctly (athlete edit)", async () => {
    await appendWorkoutEdit({
      admin: admin(),
      athleteId: "athlete-1",
      plannedWorkoutId: "pw-1",
      actorRole: "athlete",
      actorUserId: "athlete-1",
      fieldDiff: {
        scheduled_date: { from: "2026-06-01", to: "2026-06-02" },
      },
    });
    expect(mocks.lastInsertedRow).toEqual({
      athlete_id: "athlete-1",
      planned_workout_id: "pw-1",
      actor_role: "athlete",
      actor_user_id: "athlete-1",
      weekly_review_id: null,
      field_diff: { scheduled_date: { from: "2026-06-01", to: "2026-06-02" } },
    });
  });

  it("stamps actor_role='coach' and the coach's user id for a coach edit", async () => {
    await appendWorkoutEdit({
      admin: admin(),
      athleteId: "athlete-1",
      plannedWorkoutId: "pw-1",
      actorRole: "coach",
      actorUserId: "coach-9",
      fieldDiff: { status: { from: "planned", to: "skipped" } },
    });
    expect(mocks.lastInsertedRow?.actor_role).toBe("coach");
    expect(mocks.lastInsertedRow?.actor_user_id).toBe("coach-9");
    // athlete_id stays the workout owner, NOT the coach.
    expect(mocks.lastInsertedRow?.athlete_id).toBe("athlete-1");
  });

  it("defaults weekly_review_id to null for direct edits", async () => {
    await appendWorkoutEdit({
      admin: admin(),
      athleteId: "athlete-1",
      plannedWorkoutId: "pw-1",
      actorRole: "athlete",
      actorUserId: "athlete-1",
      fieldDiff: {},
    });
    expect(mocks.lastInsertedRow?.weekly_review_id).toBeNull();
  });

  it("forwards weekly_review_id when provided (ai_review path)", async () => {
    await appendWorkoutEdit({
      admin: admin(),
      athleteId: "athlete-1",
      plannedWorkoutId: "pw-1",
      actorRole: "ai_review",
      actorUserId: "system-actor",
      fieldDiff: {},
      weeklyReviewId: "wr-42",
    });
    expect(mocks.lastInsertedRow?.actor_role).toBe("ai_review");
    expect(mocks.lastInsertedRow?.weekly_review_id).toBe("wr-42");
  });

  it("returns the new row id", async () => {
    mocks.nextResult = { data: { id: "we-123" }, error: null };
    const id = await appendWorkoutEdit({
      admin: admin(),
      athleteId: "athlete-1",
      plannedWorkoutId: "pw-1",
      actorRole: "athlete",
      actorUserId: "athlete-1",
      fieldDiff: {},
    });
    expect(id).toBe("we-123");
  });

  it("throws when the insert returns an error", async () => {
    mocks.nextResult = {
      data: null,
      error: { message: "append-only: updates are not permitted", code: "P0001" },
    };
    await expect(
      appendWorkoutEdit({
        admin: admin(),
        athleteId: "athlete-1",
        plannedWorkoutId: "pw-1",
        actorRole: "athlete",
        actorUserId: "athlete-1",
        fieldDiff: {},
      }),
    ).rejects.toThrow(/appendWorkoutEdit failed/);
  });

  it("throws when the insert returns no data and no error", async () => {
    mocks.nextResult = { data: null, error: null };
    await expect(
      appendWorkoutEdit({
        admin: admin(),
        athleteId: "athlete-1",
        plannedWorkoutId: "pw-1",
        actorRole: "athlete",
        actorUserId: "athlete-1",
        fieldDiff: {},
      }),
    ).rejects.toThrow(/no data returned/);
  });
});
