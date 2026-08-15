// Color + label palette for HR and power zones in the workout-detail
// page's Zone Distribution section. Ported from the design
// bundle's `workout-details/utils.js` (POWER_ZONES / HR_ZONES). Six
// power zones follow Coggan's standard model; five HR zones follow
// the standard 60/70/80/90/100% HRmax buckets.

export interface ZoneDef {
  name: string;   // Short zone label, e.g. "Z1"
  label: string;  // Descriptive label, e.g. "Recovery"
  color: string;  // Hex, design-system aligned
}

export const POWER_ZONES: ZoneDef[] = [
  { name: "Z1", label: "Recovery",  color: "#a09890" },
  { name: "Z2", label: "Endurance", color: "#7da78c" },
  { name: "Z3", label: "Tempo",     color: "#d4a64a" },
  { name: "Z4", label: "Threshold", color: "#d97e3a" },
  { name: "Z5", label: "VO2 max",   color: "#c45a30" },
  { name: "Z6", label: "Anaerobic", color: "#8b2e1c" },
];

export const HR_ZONES: ZoneDef[] = [
  { name: "Z1", label: "60–70%",  color: "#a09890" },
  { name: "Z2", label: "70–80%",  color: "#7da78c" },
  { name: "Z3", label: "80–87%",  color: "#d4a64a" },
  { name: "Z4", label: "87–93%",  color: "#d97e3a" },
  { name: "Z5", label: "93–100%", color: "#c45a30" },
];

/**
 * Pick the palette by zone type, sized to match the number of buckets
 * Strava returned. If Strava sends more buckets than the palette has
 * entries (custom zone setups), the renderer's
 * `palette[i] ?? palette[palette.length - 1]` fallback covers the
 * out-of-bounds case — we just return the base palette truncated to
 * `count`. (MAINT-5 fix: removed speculative tail-synthesis branch.)
 */
export function paletteFor(type: "heartrate" | "power", count: number): ZoneDef[] {
  const base = type === "power" ? POWER_ZONES : HR_ZONES;
  return base.slice(0, Math.min(count, base.length));
}
