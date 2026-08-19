// Athlete-local scheduling for period-review delivery (U10).
//
// An hourly cron fires in UTC; these pure predicates decide which athletes are
// due right now in their OWN timezone, and which period just closed for them.
// Same shape and same reasoning as apps/web/src/ai/adaptive/schedule.ts, which
// does this for the weekly adaptive proposal.
//
// Pure -- no DB, no ambient clock -- so the DST and month-length behaviour is
// unit-testable.

import type { PeriodKind } from "@da2/shared";

import { localPartsInTimezone } from "@/ai/adaptive/schedule";

import { periodKeyForInstant, previousPeriodKey } from "./calendar";

/**
 * Local hour at which a period digest goes out.
 *
 * 07:00, not the 18:00 the adaptive weekly review uses: this is a
 * retrospective the athlete reads over coffee, not a proposal they act on
 * before tomorrow's session. Deliberately different from
 * WEEKLY_REVIEW_LOCAL_HOUR so the two never land in the same hour and read as
 * one duplicated email.
 */
export const DIGEST_LOCAL_HOUR = 7;

/**
 * Is this athlete due for a `kind` digest at `now`?
 *
 * Weekly fires on Monday (the week just closed on Sunday night); monthly on the
 * 1st. Exactly one hourly tick per period matches, because the predicate is an
 * equality on the local hour rather than a range.
 */
export function isDigestDue(kind: PeriodKind, timezone: string, now: Date): boolean {
  const p = localPartsInTimezone(timezone, now);
  if (p.hour !== DIGEST_LOCAL_HOUR) return false;
  return kind === "weekly" ? p.weekday === 1 : p.day === 1;
}

/**
 * The period this digest is ABOUT -- the one that just closed, not the one now
 * running.
 *
 * Derived from the calendar rather than assumed: on the Monday the weekly
 * digest fires, `periodKeyForInstant` already returns the NEW week, so the
 * subject of the email is its predecessor. Getting this wrong would mail every
 * athlete a review of a week that is one hour old and empty.
 */
export function digestPeriodKey(kind: PeriodKind, timezone: string, now: Date): string {
  return previousPeriodKey(kind, periodKeyForInstant(kind, timezone, now));
}
