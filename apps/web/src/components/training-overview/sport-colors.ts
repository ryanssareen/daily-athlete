const SPORT_COLORS: Record<string, string> = {
  run: "#c45a30",
  swim: "#1a6891",
  bike: "#2d6b44",
  strength: "#4a3a80",
  mobility: "#6b4c22",
  other: "#8a8478",
};

function canonicalSport(sport: string): string {
  const lower = sport.toLowerCase();
  if (lower.includes("run")) return "run";
  if (lower.includes("swim")) return "swim";
  if (lower.includes("bike") || lower.includes("ride")) return "bike";
  if (lower.includes("strength")) return "strength";
  if (lower.includes("mobility")) return "mobility";
  return "other";
}

export function sportColor(sport: string): string {
  return SPORT_COLORS[canonicalSport(sport)];
}

export function sportLabel(sport: string): string {
  return sport.charAt(0).toUpperCase() + sport.slice(1);
}
