// Always-visible "details" section underneath the hero / map. Groups the
// supplementary `summary_stats` fields into themed sub-cards (Context,
// Topography, Achievements, Training context) so the page reads as an
// organised brief rather than a flat JSON dump. Replaces the prior
// collapsed `<details>` overflow.
//
// Each sub-card is gated on having at least one value present — empty
// groups don't render. The component itself returns null when there's
// no data in any group, so the section disappears entirely for thin
// workouts (e.g. manual entries with just duration + name).

interface Props {
  stats: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function str(stats: Record<string, unknown>, key: string): string | null {
  const v = stats[key];
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function num(stats: Record<string, unknown>, key: string): number | null {
  const v = stats[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(stats: Record<string, unknown>, key: string): boolean | null {
  const v = stats[key];
  return typeof v === "boolean" ? v : null;
}

// ─── Card primitives ──────────────────────────────────────────────────────────

interface StatLine {
  k: string;
  v: string;
}

function Card({ title, lines, children }: { title: string; lines?: StatLine[]; children?: React.ReactNode }) {
  if ((!lines || lines.length === 0) && !children) return null;
  return (
    <div className="wd-stats-card">
      <h3 className="wd-stats-card-title">{title}</h3>
      {children}
      {lines && lines.length > 0 && (
        <dl className="wd-stats-card-list">
          {lines.map(({ k, v }) => (
            <div key={k} className="wd-stats-card-row">
              <dt className="wd-stats-card-k">{k}</dt>
              <dd className="wd-stats-card-v">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StatsDetail({ stats }: Props) {
  // Context — when the workout happened, conditions, free-form notes
  const description = str(stats, "description");
  const temp = num(stats, "average_temp");
  const trainer = bool(stats, "trainer");
  const commute = bool(stats, "commute");
  const startLocal = str(stats, "start_date_local");
  const context: StatLine[] = [];
  if (temp != null) context.push({ k: "Temperature", v: `${Math.round(temp)}°C` });
  if (trainer != null) context.push({ k: "Setting", v: trainer ? "Indoor trainer" : "Outdoor" });
  if (commute) context.push({ k: "Type", v: "Commute" });
  if (startLocal) {
    const localTime = new Date(startLocal).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", hour12: true,
    });
    context.push({ k: "Started (local)", v: localTime });
  }

  // Topography — high/low elevation; surfaced separately from the hero's
  // total_elevation_gain because the range matters in its own right.
  const elevHigh = num(stats, "elev_high");
  const elevLow = num(stats, "elev_low");
  const topography: StatLine[] = [];
  if (elevHigh != null) topography.push({ k: "Highest point", v: `${Math.round(elevHigh)} m` });
  if (elevLow != null) topography.push({ k: "Lowest point", v: `${Math.round(elevLow)} m` });
  if (elevHigh != null && elevLow != null) {
    topography.push({ k: "Range", v: `${Math.round(elevHigh - elevLow)} m` });
  }

  // Achievements — PRs and Strava segment achievements
  const prCount = num(stats, "pr_count");
  const achievementCount = num(stats, "achievement_count");
  const achievements: StatLine[] = [];
  if (prCount != null) achievements.push({ k: "PRs set", v: String(Math.round(prCount)) });
  if (achievementCount != null) {
    achievements.push({ k: "Segment achievements", v: String(Math.round(achievementCount)) });
  }

  // Training context — reference values snapshotted at hydration time
  const ftp = num(stats, "ftp_at_workout");
  const hrMax = num(stats, "hr_max_at_workout");
  const hydratedAt = str(stats, "hydrated_at");
  const training: StatLine[] = [];
  if (ftp != null) training.push({ k: "FTP at workout", v: `${ftp} W` });
  if (hrMax != null) training.push({ k: "HR max at workout", v: `${hrMax} bpm` });
  if (hydratedAt) {
    const enriched = new Date(hydratedAt);
    if (!Number.isNaN(enriched.getTime())) {
      training.push({
        k: "Enriched",
        v: enriched.toLocaleString("en-US", {
          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        }),
      });
    }
  }

  const anyCards =
    description != null ||
    context.length > 0 ||
    topography.length > 0 ||
    achievements.length > 0 ||
    training.length > 0;

  if (!anyCards) return null;

  return (
    <section className="wd-stats">
      <header className="wd-stats-head">
        <div className="wd-section-eyebrow">Details</div>
        <h2 className="wd-section-title">Context &amp; conditions</h2>
      </header>

      <div className="wd-stats-grid">
        <Card title="Context" lines={context}>
          {description && (
            <p className="wd-stats-description">{description}</p>
          )}
        </Card>
        <Card title="Topography" lines={topography} />
        <Card title="Achievements" lines={achievements} />
        <Card title="Training context" lines={training} />
      </div>
    </section>
  );
}

