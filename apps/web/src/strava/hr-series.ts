// Per-minute heart-rate series for the workout-detail chart.
//
// Pure reduction only. The raw 1Hz stream is fetched live, folded into
// minute buckets in memory and discarded — it is never written anywhere
// (migration 0008 / Strava ToS forbid persisting stream samples).

export interface HrMinutePoint {
  /** Whole minutes since the start of the activity (elapsed, not moving). */
  minute: number;
  /** Mean bpm over the samples in this minute, rounded. */
  avg: number;
  /** Highest bpm sample in this minute. */
  max: number;
}

// A day-long activity is 1440 buckets; anything beyond is junk data.
const MAX_MINUTES = 24 * 60;

/**
 * Fold parallel time (seconds) / heartrate (bpm) samples into per-minute
 * points. Minutes with no valid sample are omitted rather than zero-filled,
 * so a sensor dropout shows as a gap instead of a dive to 0 bpm.
 */
export function toPerMinute(time: readonly number[], heartrate: readonly number[]): HrMinutePoint[] {
  const n = Math.min(time.length, heartrate.length);
  const sums = new Map<number, { sum: number; count: number; max: number }>();

  for (let i = 0; i < n; i++) {
    const t = time[i]!;
    const hr = heartrate[i]!;
    if (!Number.isFinite(t) || !Number.isFinite(hr) || t < 0 || hr <= 0) continue;
    const minute = Math.floor(t / 60);
    if (minute >= MAX_MINUTES) continue;
    const bucket = sums.get(minute);
    if (bucket) {
      bucket.sum += hr;
      bucket.count += 1;
      if (hr > bucket.max) bucket.max = hr;
    } else {
      sums.set(minute, { sum: hr, count: 1, max: hr });
    }
  }

  return [...sums.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([minute, b]) => ({ minute, avg: Math.round(b.sum / b.count), max: Math.round(b.max) }));
}
