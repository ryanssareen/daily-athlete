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
  /** Mean running cadence in steps per minute; absent when not recorded. */
  cadence?: number;
  /** Mean speed in m/s over the moving samples; absent when not recorded. */
  speed?: number;
}

/** Optional parallel streams, same length/ordering as `time`. */
export interface ExtraStreams {
  /** Strava run cadence: revolutions (one foot) per minute. */
  cadence?: readonly number[];
  /** Smoothed speed in m/s. */
  velocity?: readonly number[];
}

// A day-long activity is 1440 buckets; anything beyond is junk data.
const MAX_MINUTES = 24 * 60;

/**
 * Fold parallel time (seconds) / heartrate (bpm) samples into per-minute
 * points. Minutes with no valid sample are omitted rather than zero-filled,
 * so a sensor dropout shows as a gap instead of a dive to 0 bpm.
 */
export function toPerMinute(
  time: readonly number[],
  heartrate: readonly number[],
  extra: ExtraStreams = {}
): HrMinutePoint[] {
  const n = Math.min(time.length, heartrate.length);
  const sums = new Map<number, { sum: number; count: number; max: number }>();
  const cad = new Map<number, { sum: number; count: number }>();
  const vel = new Map<number, { sum: number; count: number }>();
  const add = (m: Map<number, { sum: number; count: number }>, minute: number, v: number | undefined) => {
    // Zero means stopped / no cadence sensor reading; averaging it in would
    // drag the line toward 0 every time the athlete pauses.
    if (v === undefined || !Number.isFinite(v) || v <= 0) return;
    const b = m.get(minute);
    if (b) {
      b.sum += v;
      b.count += 1;
    } else m.set(minute, { sum: v, count: 1 });
  };

  for (let i = 0; i < n; i++) {
    const t = time[i]!;
    const hr = heartrate[i]!;
    if (!Number.isFinite(t) || !Number.isFinite(hr) || t < 0 || hr <= 0) continue;
    const minute = Math.floor(t / 60);
    if (minute >= MAX_MINUTES) continue;
    add(cad, minute, extra.cadence?.[i]);
    add(vel, minute, extra.velocity?.[i]);
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
    .map(([minute, b]) => {
      const point: HrMinutePoint = { minute, avg: Math.round(b.sum / b.count), max: Math.round(b.max) };
      const c = cad.get(minute);
      // Strava reports one-foot cadence for runs; double to steps per minute.
      if (c) point.cadence = Math.round((c.sum / c.count) * 2);
      const v = vel.get(minute);
      if (v) point.speed = Math.round((v.sum / v.count) * 100) / 100;
      return point;
    });
}
