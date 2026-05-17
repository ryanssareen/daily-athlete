const SPORT_EMOJI: Record<string, string> = {
  swim: "🏊",
  bike: "🚴",
  run: "🏃",
  strength: "💪",
  mobility: "🧘",
  other: "⚡",
};

const SPORT_LABEL: Record<string, string> = {
  swim: "Swim",
  bike: "Bike",
  run: "Run",
  strength: "Strength",
  mobility: "Mobility",
  other: "Workout",
};

export function getSportEmoji(sport: string): string {
  return SPORT_EMOJI[sport.toLowerCase()] ?? "⚡";
}

export function getSportLabel(sport: string): string {
  return SPORT_LABEL[sport.toLowerCase()] ?? "Workout";
}
