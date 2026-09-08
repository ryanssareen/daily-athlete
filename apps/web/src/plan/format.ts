// Shared date formatters for the plan surfaces (list, detail, summary).

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// event_date is a DATE-only string ("YYYY-MM-DD"), not a timestamp. Parsing
// it with `new Date(str)` reads it as UTC midnight, which renders as the
// PREVIOUS day in any timezone west of UTC once toLocaleDateString converts
// to local time. Parse the components directly instead.
export function formatEventDate(dateOnly: string): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
