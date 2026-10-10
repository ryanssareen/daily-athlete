// Time-of-day greeting in the athlete's own timezone, not the server's (or the
// UTC fallback baked into users.timezone's DEFAULT).
export function getGreeting(timezone: string, now: Date = new Date()): string {
  let hour: number;
  try {
    hour = Number(
      now.toLocaleString("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      })
    );
  } catch {
    // Intl throws RangeError for a syntactically invalid timezone; a corrupted
    // users.timezone must not take the greeting down.
    hour = now.getUTCHours();
  }
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
