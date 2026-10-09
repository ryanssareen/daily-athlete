const SPORT_COLORS: Record<string, string> = {
  run: "#c45a30",
  swim: "#1a6891",
  bike: "#2d6b44",
  strength: "#4a3a80",
  mobility: "#6b4c22",
};

export function sportColor(sport: string): string {
  return SPORT_COLORS[sport] ?? "var(--color-ink-subtle)";
}

export function sportLabel(sport: string): string {
  return sport.charAt(0).toUpperCase() + sport.slice(1);
}
