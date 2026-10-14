---
title: Screens Must Show What the Entity Contains, Not Its Row Metadata
date: 2026-10-14
status: active
---

# Screens Must Show What the Entity Contains, Not Its Row Metadata

## Symptom (keeps recurring)

A screen is "done" but tells the athlete nothing:

- **Mobile Plan tab / plan detail** showed `Event date`, `Created`, `Source: AI generated`
  and nothing else. The plan's actual content (weeks, volume, sports, what's next) lived
  only in the Calendar tab, so the Plan tab felt empty and redundant.
- **Activity detail "More stats"** dumped every leftover Strava JSON key as a raw row
  (`Manual false`, `Utc Offset 19800`, `Pr Count 0`, `Start Date Local ...`).

Both are the same mistake from opposite directions: rendering whatever the table/JSON
happens to contain instead of deciding what the athlete wants to know.

## Why it happens

`public.plans` has no content columns — only `event_type`, `event_date`, `status`,
`source`, timestamps. A screen built by mirroring the row can only show metadata. A plan's
content is *derived* from its `planned_workouts`.

## Rules

1. Before building a detail screen, write down the 3 questions the athlete opens it to
   answer ("Where am I in the plan? What's next? How much training is this?"). If the row
   can't answer them, derive the answer from related rows.
2. `source`, `created_at`, `status` badges, ids and other bookkeeping are a **footnote**,
   never the body. "It's AI generated" is not information the athlete acts on.
3. Never render an open-ended JSON blob (`summary_stats`, `structure`) as a key/value
   dump. Allowlist the keys that matter, give them human labels and units, drop the rest.
4. A tab must not be a thin pointer to another tab. If the Plan tab's best content is "go
   look at the Calendar", the Plan tab has failed.
5. Check the screen with a real, populated account (and an empty one) before calling it
   done — see "A UI change is not verified until someone has looked at it" in AGENTS.md.

## Where it lives now

- `daily-athlete/lib/features/plans/plan_summary.dart` — pure derivation (weeks, volume,
  sport mix, next session) from planned workouts; unit-tested.
- `daily-athlete/lib/features/plans/plan_overview.dart` — shared by the Plan tab (active
  plan) and plan detail (any plan).
- `daily-athlete/lib/features/activities/activity_detail_screen.dart` — `_extraStats`
  allowlist replaces the raw overflow dump.

The web `/plan` page has the same gap (`PlanSummaryCard` shows little beyond an upcoming
count) and is not yet fixed.
