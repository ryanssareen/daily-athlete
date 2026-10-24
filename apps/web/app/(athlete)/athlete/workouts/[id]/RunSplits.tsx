// Strava-computed per-km splits and best efforts, from `summary_stats`
// (`splits_metric`, `best_efforts`). Both are aggregates Strava returns on
// the activity detail response; no stream samples are involved.
//
// Reuses the lap-table styling so the page keeps one visual language.
// Renders nothing when neither field is present (bike, swim, manual).

interface Split {
  split: number;
  distance: number;
  elapsed_time: number;
  average_heartrate?: number;
  elevation_difference?: number;
}

interface BestEffort {
  name: string;
  distance: number;
  elapsed_time: number;
  pr_rank?: number | null;
}

interface Props {
  splits: unknown;
  bestEfforts: unknown;
}

function isSplit(v: unknown): v is Split {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.split === "number" &&
    typeof o.distance === "number" &&
    typeof o.elapsed_time === "number" &&
    o.distance > 0
  );
}

function isBestEffort(v: unknown): v is BestEffort {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.distance === "number" &&
    typeof o.elapsed_time === "number"
  );
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** min:sec per km for one split. */
function paceKm(distanceM: number, seconds: number): string {
  return `${clock((seconds / distanceM) * 1000)} /km`;
}

export function RunSplits({ splits: splitsRaw, bestEfforts: effortsRaw }: Props) {
  const splits = Array.isArray(splitsRaw) ? splitsRaw.filter(isSplit) : [];
  const efforts = Array.isArray(effortsRaw) ? effortsRaw.filter(isBestEffort) : [];
  if (splits.length < 2 && efforts.length === 0) return null;

  // Bar length is pace relative to the fastest and slowest split, so the
  // shape of the run (fade, negative split) reads at a glance.
  const paces = splits.map((s) => s.elapsed_time / s.distance);
  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  const spread = slowest - fastest || 1;

  return (
    <>
      {splits.length >= 2 && (
        <section className="wd-laps">
          <header className="wd-laps-head">
            <div>
              <div className="wd-section-eyebrow">Pace</div>
              <h2 className="wd-section-title">Kilometre splits</h2>
            </div>
            <span className="wd-laps-count">{splits.length} km</span>
          </header>
          <div className="wd-laps-table">
            {splits.map((s, i) => {
              const widthPct = 40 + (1 - (paces[i]! - fastest) / spread) * 60;
              return (
                <div className="wd-laps-row is-splits" key={s.split} role="row">
                  <span className="wd-lap-num">{s.split}</span>
                  <span className="wd-lap-label">
                    <span
                      className="wd-split-bar"
                      style={{ width: `${widthPct}%` }}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="wd-lap-val">{paceKm(s.distance, s.elapsed_time)}</span>
                  <span className="wd-lap-val">
                    {s.average_heartrate != null ? `${Math.round(s.average_heartrate)} bpm` : "—"}
                  </span>
                  <span className="wd-lap-val">
                    {s.elevation_difference != null
                      ? `${s.elevation_difference > 0 ? "+" : ""}${Math.round(s.elevation_difference)} m`
                      : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {efforts.length > 0 && (
        <section className="wd-stats">
          <header className="wd-stats-head">
            <div className="wd-section-eyebrow">Records</div>
            <h2 className="wd-section-title">Best efforts</h2>
          </header>
          <div className="wd-stats-card">
            <dl className="wd-stats-card-list">
              {efforts.map((e) => (
                <div key={e.name} className="wd-stats-card-row">
                  <dt className="wd-stats-card-k">
                    {e.name}
                    {e.pr_rank === 1 ? " · PR" : ""}
                  </dt>
                  <dd className="wd-stats-card-v">{clock(e.elapsed_time)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}
    </>
  );
}
