// Power-based training-load math. All pure functions; no I/O.
// Used at Strava-hydration time to snapshot IF + TSS for a workout
// using the athlete's FTP *at the time of the workout*. We deliberately
// store the derived values rather than re-computing at render time so
// historic workouts keep their original training-load reading when
// the athlete's FTP changes later.

/**
 * Intensity Factor = normalized_power / ftp.
 * Standard ranges:
 *   < 0.75   → recovery / easy
 *   0.75-0.85 → endurance
 *   0.85-0.95 → tempo
 *   0.95-1.05 → threshold (1.0 = exactly at FTP for 1h = canonical TSS=100)
 *   > 1.05    → VO2max / anaerobic
 *
 * Returns `null` for invalid inputs (zero/negative ftp, zero/negative np).
 */
export function computeIF(normalizedPowerW: number, ftpW: number): number | null {
  if (!Number.isFinite(normalizedPowerW) || normalizedPowerW <= 0) return null;
  if (!Number.isFinite(ftpW) || ftpW <= 0) return null;
  return normalizedPowerW / ftpW;
}

/**
 * Training Stress Score, the Coggan formula:
 *
 *   TSS = (duration_s × NP × IF) / (FTP × 3600) × 100
 *
 * Canonical anchor: 1 hour exactly at FTP = TSS 100. A 2-hour ride at
 * 0.7 IF (endurance pace) ≈ TSS 98. A 20-minute VO2max effort at 1.15 IF
 * ≈ TSS 44.
 *
 * Returns `null` when IF cannot be computed (see `computeIF`) or when
 * `durationSec <= 0`.
 */
export function computeTSS(
  durationSec: number,
  normalizedPowerW: number,
  ftpW: number
): number | null {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  const intensityFactor = computeIF(normalizedPowerW, ftpW);
  if (intensityFactor == null) return null;
  return (durationSec * normalizedPowerW * intensityFactor) / (ftpW * 3600) * 100;
}
