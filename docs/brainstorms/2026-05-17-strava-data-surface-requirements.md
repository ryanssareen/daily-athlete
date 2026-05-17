---
date: 2026-05-17
topic: strava-data-surface
---

# Strava Data Surface — What Push + Hydration Can Give Us

## Problem Frame

When a Strava push webhook fires we already call `GET /activities/{id}` to hydrate
the activity. We currently capture ~10 fields. Strava exposes significantly more
per activity — and additional endpoints (laps, zones, athlete stats) provide
richer training data. This document maps the full Strava data surface so planning
can decide what to store, what UI it enables, and what's off-limits by ToS.

---

## How Push + Hydration Works

```
Strava push event (webhook POST)
    └─ object_type: "activity" | "athlete"
    └─ aspect_type: "create" | "update" | "delete"
    └─ object_id: <strava_activity_id>
    └─ owner_id: <athlete_strava_id>
    └─ event_time: <unix>

         ↓  (for create/update)

GET /activities/{id}          ← main hydration call (1 API credit)
GET /activities/{id}/laps     ← optional, +1 credit
GET /activities/{id}/zones    ← optional, +1 credit (premium athletes only)
GET /athlete/stats            ← optional, call on demand (not per-event)
```

Rate limit: 100 requests/15 min, 1000/day per app token.
Every webhook event currently costs 1 credit. Adding laps + zones = 3 credits/event.

---

## Available Fields

### From `GET /activities/{id}` — Main Activity

All fields below come from the single hydration call. No extra rate limit cost.

**Core — Currently Captured**

| Field | Stored As | Notes |
|---|---|---|
| `id` | `strava_activity_id` | |
| `sport_type` | `sport` (normalized) | Run/Ride/Swim/etc → internal enum |
| `start_date` | `started_at` | UTC ISO string |
| `moving_time` | `duration_s` | Preferred over elapsed_time |
| `elapsed_time` | `duration_s` fallback | Used when moving_time absent |
| `distance` | `distance_m` (rounded) | |
| `average_speed` | `summary_stats.average_speed` | m/s |
| `max_speed` | `summary_stats.max_speed` | m/s |
| `average_heartrate` | `summary_stats.average_heartrate` | bpm |
| `max_heartrate` | `summary_stats.max_heartrate` | bpm |
| `average_watts` | `summary_stats.average_watts` | |
| `total_elevation_gain` | `summary_stats.total_elevation_gain` | meters |
| `suffer_score` | `summary_stats.suffer_score` | Strava's relative effort score |

**Not Yet Captured — No Extra API Call Needed**

| Field | Type | Product Value |
|---|---|---|
| `name` | string | Activity title on cards, athlete context, search |
| `description` | string? | Athlete notes / coach annotation |
| `calories` | int? | Training load context, nutrition pairing |
| `average_cadence` | float? | Run cadence, cycling RPM — technique metric |
| `weighted_average_watts` | int? | Normalized power (NP) — more meaningful than avg for cyclists |
| `kilojoules` | float? | Energy expenditure; more accurate load metric than calories |
| `max_watts` | int? | Peak power output |
| `elev_high` | float? | Highest point in meters |
| `elev_low` | float? | Lowest point |
| `average_temp` | int? | Celsius; useful for heat/cold training context |
| `device_watts` | bool | True = real power meter, False = estimated — critical to show |
| `has_heartrate` | bool | Whether HR sensor was present |
| `trainer` | bool | Indoor trainer vs outdoor ride |
| `commute` | bool | Filter commutes from training activities |
| `manual` | bool | Logged manually vs recorded by device |
| `pr_count` | int | Personal records set in this activity |
| `achievement_count` | int | Segment achievements |
| `kudos_count` | int | Social signal |
| `gear_id` | string? | Shoe/bike used — gear tracking |
| `start_date_local` | string | Local time (useful for display without tz logic) |
| `utc_offset` | float | Offset in seconds |
| `visibility` | enum | "everyone" / "followers_only" / "only_me" |

**Excluded by Strava ToS (R18 — No Raw Stream Samples)**

| Field | Why Excluded |
|---|---|
| `map.polyline` | GPS route (stream-level) |
| `map.summary_polyline` | Even summary polyline excluded to be safe |
| `start_latlng` / `end_latlng` | Location coordinates |

---

### From `GET /activities/{id}/laps` — Lap Splits

+1 API credit per activity. Returns an array of laps.

| Field per Lap | Type | Product Value |
|---|---|---|
| `lap_index` | int | Ordering |
| `split` | int? | For auto-split activities |
| `elapsed_time` | int | Lap duration |
| `moving_time` | int | Active time in lap |
| `distance` | float | Lap distance |
| `average_speed` | float | Lap pace |
| `max_speed` | float | |
| `average_heartrate` | float? | |
| `max_heartrate` | float? | |
| `average_cadence` | float? | |
| `average_watts` | float? | |
| `total_elevation_gain` | float? | |
| `start_index` / `end_index` | int | Stream indices (don't use — excludes streams) |

**Product value:** Lap-by-lap pacing charts, interval detection (structured workout verification), run split tables. High value for serious athletes.

---

### From `GET /activities/{id}/zones` — Training Zones

+1 API credit. Only meaningful if athlete has set HR/power zones in Strava (typically premium).

| Data | Product Value |
|---|---|
| HR zones (time in each zone Z1–Z5) | Aerobic distribution, zone 2 training tracking |
| Power zones (time in each zone) | TSS-like training load |

**Note:** Strava only returns zones if the athlete has configured them. Response can be empty. Low priority until we have athletes using power meters or serious HR-zone training.

---

### From `GET /athlete/stats` — Lifetime & Period Totals

On-demand call (not per push event). 1 API credit.

| Field | Type | Product Value |
|---|---|---|
| `recent_run_totals.distance` | float | Last 4 weeks run volume |
| `recent_ride_totals.distance` | float | Last 4 weeks ride volume |
| `recent_swim_totals.distance` | float | Last 4 weeks swim volume |
| `ytd_run_totals.distance` / `count` | float / int | Year-to-date run volume |
| `ytd_ride_totals.distance` / `count` | float / int | YTD ride volume |
| `all_run_totals.distance` / `count` | float / int | Career totals |
| `all_ride_totals.elevation_gain` | float | Career elevation |

**Product value:** Dashboard summary cards ("You've run 847 km this year"), volume trend charts. Could be polled once per day rather than per-event.

---

### From Push Event Only (No API Call Needed)

| Field | Notes |
|---|---|
| `event_time` | When Strava processed the event (not activity start) |
| `updates` | On `aspect_type=update`: which fields changed (e.g. `{"title": "Morning Run"}`) |
| `object_type=athlete` | Profile change events (name, weight, etc.) — currently ignored |

For `update` events, the `updates` object can tell us what changed without re-fetching everything. Currently we re-fetch the full activity regardless.

---

## What We Currently Capture vs. What We Could

| Category | Currently | Could Add (no extra calls) | Could Add (extra calls) |
|---|---|---|---|
| Identity | id, sport, started_at | name, description, visibility, manual, commute | — |
| Duration | moving_time, elapsed_time | start_date_local | — |
| Distance | distance_m | — | — |
| Speed | avg + max speed | — | lap avg speeds |
| Heart rate | avg + max HR | has_heartrate flag | zone time (zones endpoint) |
| Power | avg watts | weighted_avg_watts, max_watts, device_watts, kilojoules | zone time (zones endpoint) |
| Elevation | total_gain | elev_high, elev_low | per-lap gain |
| Cadence | — | average_cadence | per-lap cadence |
| Load/Effort | suffer_score | calories | — |
| Training context | — | trainer (indoor/outdoor), gear_id, average_temp | — |
| Social | — | kudos_count, pr_count, achievement_count | — |
| Laps | — | — | full lap splits array |
| Athlete totals | — | — | ytd/lifetime stats |

---

## Requirements

**Data Capture Expansion**

- R1. Expand `StravaActivitySchema` to include all non-GPS fields from `GET /activities/{id}` that have product value (name, calories, average_cadence, weighted watts, kilojoules, max watts, device_watts, has_heartrate, trainer, commute, manual, elev_high, elev_low, pr_count, start_date_local).
- R2. Store `name` in a dedicated column on `completed_workouts` (not just JSONB) — it's used for display and potentially search.
- R3. Store all other new numeric fields in the existing `summary_stats` JSONB column — no schema migration required.
- R4. On `aspect_type=update` push events, use the `updates` field to skip re-fetching when only social fields (kudos, title) changed and we don't care about them.

**Lap Data (Lower Priority)**

- R5. Optionally fetch `GET /activities/{id}/laps` on create/update events and store lap array in `summary_stats.laps` JSONB. Gated behind a flag or athlete preference — not every athlete needs laps. Adds 1 extra API credit per event.

**Athlete Stats**

- R6. Fetch `GET /athlete/stats` once per day (not per push event) and cache in `athlete_profiles.strava_stats` JSONB. Powers dashboard volume summary cards.

**Training Zones (Future)**

- R7. Zones endpoint deferred — low value until we show zone distribution UI. Note as future capability.

---

## Success Criteria

- Activity cards display name + key stats (sport, distance, duration, HR, pace/power)
- `device_watts` flag prevents showing estimated power as real data
- `trainer` flag filters indoor sessions correctly on calendar/activities views
- `commute` flag can be toggled to hide/show commute rides
- Dashboard shows YTD volume per sport from athlete stats
- No Strava ToS violations (no GPS, no stream-level samples)

---

## Scope Boundaries

- GPS/streams excluded permanently (Strava ToS R18)
- Social metrics (kudos, comments) stored but not surfaced in UI — captured for completeness
- Zone time deferred until zone distribution UI is designed
- Lap data is optional / athlete preference — not a core requirement

---

## Key Decisions

- **JSONB for new stats:** All new numeric fields go in `summary_stats` JSONB rather than new columns. Low schema friction, easy to add/remove.
- **`name` gets a column:** The one field that deserves a dedicated column since it drives display and search.
- **Athlete stats via daily cron:** Not per-event — Strava's aggregate stats update at most hourly and a per-push fetch would waste credits.
- **Laps are optional:** Rate cost (3x per event) and storage cost mean laps are opt-in, not default.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] What migration adds `name TEXT` to `completed_workouts`? Check if any existing query breaks by adding the column.
- [Affects R5][Technical] What's the right rate limit strategy when laps are enabled for a large backfill? Need a delay or batch cap.
- [Affects R6][Blocking] A new migration is required to `ADD COLUMN strava_stats JSONB NOT NULL DEFAULT '{}'::jsonb` to `athlete_profiles` before R6 can be implemented. Follow the pattern of migration 0009 (backfill_status).
- [Affects R6][Technical] Where does the daily athlete stats cron live — Next.js cron route or Inngest scheduled function? Note: the existing Vercel Hobby plan has one cron slot occupied by the backfill watchdog; a second slot or an Inngest scheduled function may be needed.

---

## Next Steps

→ `/ce:plan` for structured implementation planning
