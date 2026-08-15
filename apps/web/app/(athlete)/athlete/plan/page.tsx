import { PlannedHero } from "./Hero";
import { AIInsight } from "./AIInsight";
import { StructureList } from "./StructureList";
import { ActionBar } from "./ActionBar";
import type { PlannedWorkoutData } from "./types";
import "./plan.css";

// Mock data — athlete-facing planned workout
const PLANNED_DATA: PlannedWorkoutData = {
  sport: "bike",
  status: "planned",
  scheduledDateLabel: "Monday, August 17",
  weekLabel: "Week 12 · Build 2",
  name: "Sweet Spot 3×12'",
  type: "Threshold",
  ftp: 258,
  targetDistanceKm: 32,
  vs: { duration: 0.06, tss: 0.09 },
  attribution: {
    kind: "ai_review",
    note: "Bumped from 2 × 15' after last week's threshold session came in clean — this progresses load without adding volume before Saturday's long ride.",
  },
  description: "3 × 12 minutes at 88–94% FTP (Z4) with 5 minute spin recovery between reps. Stay seated, hold cadence 85–95 rpm — the goal is steady power, not surges.",
  segments: [
    { label: "Warm-up", durSec: 720, zone: 1, target: "Z1 · easy spin" },
    { label: "Rep 1", durSec: 720, zone: 4, target: "227–242 W" },
    { label: "Recovery", durSec: 300, zone: 1, target: "Z1 · easy spin" },
    { label: "Rep 2", durSec: 720, zone: 4, target: "227–242 W" },
    { label: "Recovery", durSec: 300, zone: 1, target: "Z1 · easy spin" },
    { label: "Rep 3", durSec: 720, zone: 4, target: "227–242 W" },
    { label: "Cool-down", durSec: 300, zone: 1, target: "Z1 · easy spin" },
  ],
};

export default function PlannedWorkoutPage() {
  return (
    <main className="page-main">
      <div className="page-container" data-screen-label="Athlete · Planned workout">
        <PlannedHero data={PLANNED_DATA} />
        <AIInsight data={PLANNED_DATA} />
        <StructureList data={PLANNED_DATA} />
        <ActionBar />
      </div>
    </main>
  );
}
