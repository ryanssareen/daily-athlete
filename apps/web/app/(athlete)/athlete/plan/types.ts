export interface WorkoutSegment {
  label: string;
  durSec: number;
  zone: number;
  target: string;
}

export interface PlannedWorkoutData {
  sport: "bike" | "run" | "swim";
  status: "planned" | "in-progress" | "completed";
  scheduledDateLabel: string;
  weekLabel: string;
  name: string;
  type: string;
  ftp: number;
  targetDistanceKm: number;
  vs: {
    duration: number;
    tss: number;
  };
  attribution: {
    kind: "ai_review" | "coach";
    note: string;
  };
  description: string;
  segments: WorkoutSegment[];
}
