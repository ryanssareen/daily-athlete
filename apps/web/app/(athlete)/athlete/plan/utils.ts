export const SPORT_ACCENT: Record<string, { color: string; deep: string; soft: string }> = {
  bike: { color: "#2d6b44", deep: "#1f4d31", soft: "color-mix(in oklab, #2d6b44 12%, transparent)" },
  run: { color: "#c45a30", deep: "#a4451f", soft: "color-mix(in oklab, #c45a30 12%, transparent)" },
  swim: { color: "#1a6891", deep: "#0e4a6b", soft: "color-mix(in oklab, #1a6891 12%, transparent)" },
};

export const POWER_ZONES = [
  { name: "Z1", label: "Recovery", max: 0.56, color: "#a09890" },
  { name: "Z2", label: "Endurance", max: 0.76, color: "#7da78c" },
  { name: "Z3", label: "Tempo", max: 0.91, color: "#d4a64a" },
  { name: "Z4", label: "Threshold", max: 1.06, color: "#d97e3a" },
  { name: "Z5", label: "VO2 max", max: 1.21, color: "#c45a30" },
  { name: "Z6", label: "Anaerobic", max: 999, color: "#8b2e1c" },
];

export function fmtClockShort(seconds: number): string {
  seconds = Math.round(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
