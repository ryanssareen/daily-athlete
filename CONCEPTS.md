# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Workouts and days

### Planned workout
A session an athlete is meant to do, scheduled for a Training day rather than a moment in time. It comes from an AI-generated plan, a coach, or an import, and is compared against Completed workouts to judge whether the plan was followed.

### Completed workout
A session the athlete actually did, recorded as a real instant (when it started) plus its duration and summary stats. It is either synced from Strava or logged as a Manual workout.

### Manual workout
A Completed workout the athlete logged by hand instead of syncing it. The web forms ask only for a day, not a time, so the app must choose a sensible instant inside that Training day on the athlete's behalf.

When the same effort later arrives from Strava, the Strava record becomes canonical and the manual one is kept only as a superseded trace, hidden from normal views.

### Training day
The calendar day a session belongs to, judged in the Athlete timezone — never the UTC day. Planned workouts are scheduled on Training days, and every comparison between a completed instant and a scheduled day happens in that zone.
*Avoid:* UTC day, server day

### Athlete timezone
The athlete's own zone, captured from their browser and used everywhere a stored instant is shown or turned into a Training day. Instants are stored in UTC; the athlete timezone is applied only when reading or rendering.

## Flagged ambiguities

- "Today" had been taken from the UTC clock in more than one place; in this project it always means today's Training day in the Athlete timezone.
