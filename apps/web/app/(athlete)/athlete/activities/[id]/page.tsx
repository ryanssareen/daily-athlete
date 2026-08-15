"use client";

import { useState } from "react";
import { WorkoutHero } from "./Hero";
import { WorkoutIntervals } from "./Intervals";
import { WorkoutMetrics } from "./Metrics";
import { WorkoutLaps } from "./Laps";
import { WorkoutTakeaway } from "./Takeaway";
import { WorkoutNotes } from "./Notes";
import type { WorkoutData } from "./types";
import "./workout.css";

// Mock workout data
const MOCK_WORKOUT: WorkoutData = {
  name: "VO2 intervals — Skyline loop",
  sport: "bike",
  source: "strava",
  startedAt: "Tuesday, May 19 · 12:42 PM",
  timezoneShort: "PT",
  weather: { tempF: 63, condition: "Partly cloudy", windMph: 7, windDir: "WNW" },
  location: "Woodside, CA",
  duration: 6138, // 1:42:18
  distanceM: 38200,
  avgPower: 215,
  normalizedPower: 248,
  maxPower: 612,
  avgHR: 152,
  maxHR: 178,
  avgCadence: 86,
  avgSpeedKmh: 22.4,
  elevationGain: 1240,
  sufferScore: 87,
  tss: 124,
  intensityFactor: 0.94,
  kJ: 1318,
  rpe: 8,
  ftp: 265,
  hrMax: 188,
  series: {
    t: Array.from({ length: 180 }, (_, i) => (i / 179) * 6138),
    power: Array.from({ length: 180 }, () => 200 + Math.random() * 100),
    hr: Array.from({ length: 180 }, () => 140 + Math.random() * 40),
    cadence: Array.from({ length: 180 }, () => 80 + Math.random() * 20),
    elevation: Array.from({ length: 180 }, (_, i) => {
      const f = i / 179;
      const base = 142;
      const climb = 380 * Math.sin(f * Math.PI);
      const rolling = 25 * Math.sin(f * Math.PI * 8);
      return base + Math.max(0, climb) + rolling;
    }),
    speed: Array.from({ length: 180 }, () => 20 + Math.random() * 12),
  },
  intervals: [
    { kind: "warmup", durSec: 900, targetW: 165, label: "Warm-up", startSec: 0, endSec: 900 },
    { kind: "work", durSec: 240, targetW: 300, label: "Rep 1", startSec: 900, endSec: 1140 },
    { kind: "recover", durSec: 180, targetW: 150, label: "Rec", startSec: 1140, endSec: 1320 },
    { kind: "work", durSec: 240, targetW: 300, label: "Rep 2", startSec: 1320, endSec: 1560 },
    { kind: "recover", durSec: 180, targetW: 150, label: "Rec", startSec: 1560, endSec: 1740 },
    { kind: "work", durSec: 240, targetW: 300, label: "Rep 3", startSec: 1740, endSec: 1980 },
    { kind: "recover", durSec: 180, targetW: 150, label: "Rec", startSec: 1980, endSec: 2160 },
    { kind: "work", durSec: 240, targetW: 300, label: "Rep 4", startSec: 2160, endSec: 2400 },
    { kind: "recover", durSec: 180, targetW: 150, label: "Rec", startSec: 2400, endSec: 2580 },
    { kind: "work", durSec: 240, targetW: 300, label: "Rep 5", startSec: 2580, endSec: 2820 },
    { kind: "cooldown", durSec: 3318, targetW: 140, label: "Cool-down", startSec: 2820, endSec: 6138 },
  ],
  laps: [
    { i: 0, label: "Warm-up", kind: "warmup", durSec: 900, targetW: 165, avgW: 162, avgHR: 128, distM: 4200 },
    { i: 1, label: "Rep 1", kind: "work", durSec: 240, targetW: 300, avgW: 312, avgHR: 165, distM: 1520 },
    { i: 2, label: "Rec", kind: "recover", durSec: 180, targetW: 150, avgW: 148, avgHR: 135, distM: 850 },
    { i: 3, label: "Rep 2", kind: "work", durSec: 240, targetW: 300, avgW: 305, avgHR: 167, distM: 1510 },
    { i: 4, label: "Rec", kind: "recover", durSec: 180, targetW: 150, avgW: 150, avgHR: 133, distM: 860 },
    { i: 5, label: "Rep 3", kind: "work", durSec: 240, targetW: 300, avgW: 318, avgHR: 168, distM: 1540 },
    { i: 6, label: "Rec", kind: "recover", durSec: 180, targetW: 150, avgW: 149, avgHR: 135, distM: 855 },
    { i: 7, label: "Rep 4", kind: "work", durSec: 240, targetW: 300, avgW: 295, avgHR: 162, distM: 1480 },
    { i: 8, label: "Rec", kind: "recover", durSec: 180, targetW: 150, avgW: 151, avgHR: 133, distM: 865 },
    { i: 9, label: "Rep 5", kind: "work", durSec: 240, targetW: 300, avgW: 308, avgHR: 167, distM: 1530 },
    { i: 10, label: "Cool-down", kind: "cooldown", durSec: 3318, targetW: 140, avgW: 138, avgHR: 125, distM: 18043 },
  ],
  workReps: [
    { i: 1, repNum: 1, label: "Rep 1", kind: "work", durSec: 240, targetW: 300, actualW: 312, avgHR: 165, distM: 1520 },
    { i: 3, repNum: 2, label: "Rep 2", kind: "work", durSec: 240, targetW: 300, actualW: 305, avgHR: 167, distM: 1510 },
    { i: 5, repNum: 3, label: "Rep 3", kind: "work", durSec: 240, targetW: 300, actualW: 318, avgHR: 168, distM: 1540 },
    { i: 7, repNum: 4, label: "Rep 4", kind: "work", durSec: 240, targetW: 300, actualW: 295, avgHR: 162, distM: 1480 },
    { i: 9, repNum: 5, label: "Rep 5", kind: "work", durSec: 240, targetW: 300, actualW: 308, avgHR: 167, distM: 1530 },
  ],
  zones: {
    power: [420, 580, 850, 1200, 1600, 488],
    hr: [380, 1050, 1480, 1820, 1388],
  },
  vsAvg: {
    duration: 0.18,
    avgPower: 0.08,
    avgHR: 0.02,
    elevationGain: 0.34,
    tss: 0.22,
  },
};

export default function WorkoutDetailsPage() {
  const [rpe, setRpe] = useState(MOCK_WORKOUT.rpe);
  const [notes, setNotes] = useState("Legs felt good. Wind picked up on the last climb but the recovery was smooth.");
  const [showPlannedMatch, setShowPlannedMatch] = useState(true);
  const [showTakeaway, setShowTakeaway] = useState(true);

  return (
    <main className="page-main">
      <div className="page-container">
        <WorkoutHero data={MOCK_WORKOUT} />

        {showPlannedMatch && <WorkoutIntervals data={MOCK_WORKOUT} />}

        <WorkoutMetrics data={MOCK_WORKOUT} />

        <WorkoutLaps data={MOCK_WORKOUT} />

        {showTakeaway && <WorkoutTakeaway data={MOCK_WORKOUT} />}

        <WorkoutNotes rpe={rpe} notes={notes} onRpeChange={setRpe} onNotesChange={setNotes} />

        <footer className="page-foot">
          <span>Workout ID · wkt_b3f7a921</span>
          <span className="meta-dot">·</span>
          <span>Synced from Strava · 4 min ago</span>
        </footer>
      </div>
    </main>
  );
}
