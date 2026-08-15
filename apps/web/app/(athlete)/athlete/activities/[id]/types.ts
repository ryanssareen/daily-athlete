export interface WorkoutInterval {
  kind: "warmup" | "work" | "recover" | "cooldown";
  durSec: number;
  targetW: number;
  label: string;
  startSec: number;
  endSec: number;
}

export interface WorkoutLap {
  i: number;
  label: string;
  kind: string;
  durSec: number;
  targetW: number;
  avgW: number;
  avgHR: number;
  distM: number;
}

export interface WorkoutRep {
  i: number;
  repNum: number;
  label: string;
  kind: string;
  durSec: number;
  targetW: number;
  actualW: number;
  avgHR: number;
  distM: number;
}

export interface WorkoutSeries {
  t: number[];
  power: number[];
  hr: number[];
  cadence: number[];
  elevation: number[];
  speed: number[];
}

export interface WorkoutData {
  name: string;
  sport: "bike" | "run" | "swim";
  source: "strava" | "garmin" | "wahoo";
  startedAt: string;
  timezoneShort: string;
  weather: {
    tempF: number;
    condition: string;
    windMph: number;
    windDir: string;
  };
  location: string;
  duration: number;
  distanceM: number;
  avgPower: number;
  normalizedPower: number;
  maxPower: number;
  avgHR: number;
  maxHR: number;
  avgCadence: number;
  avgSpeedKmh: number;
  elevationGain: number;
  sufferScore: number;
  tss: number;
  intensityFactor: number;
  kJ: number;
  rpe: number;
  ftp: number;
  hrMax: number;
  series: WorkoutSeries;
  intervals: WorkoutInterval[];
  laps: WorkoutLap[];
  workReps: WorkoutRep[];
  zones: {
    power: number[];
    hr: number[];
  };
  vsAvg: {
    duration: number;
    avgPower: number;
    avgHR: number;
    elevationGain: number;
    tss: number;
  };
}
