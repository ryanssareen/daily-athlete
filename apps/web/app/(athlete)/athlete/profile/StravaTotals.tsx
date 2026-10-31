import { loadStravaTotals, type SportTotals } from "@/strava/load-totals";
import type { createAdminClient } from "@/db/admin";
import type { StravaTotals as Totals } from "@/strava/schemas";

const SPORT_LABEL: Record<SportTotals["sport"], string> = {
  run: "Running",
  ride: "Riding",
  swim: "Swimming",
};

function fmtKm(meters: number): string {
  const km = meters / 1000;
  return `${km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(1)} km`;
}

function fmtHours(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Row({ label, t }: { label: string; t: Totals }) {
  if (t.count === 0) return null;
  return (
    <tr>
      <th scope="row" style={{ textAlign: "left", fontWeight: 500, padding: "4px 12px 4px 0" }}>
        {label}
      </th>
      <td style={{ padding: "4px 12px 4px 0" }}>{t.count} activities</td>
      <td style={{ padding: "4px 12px 4px 0" }}>{fmtKm(t.distance)}</td>
      <td style={{ padding: "4px 12px 4px 0" }}>{fmtHours(t.moving_time)}</td>
      <td style={{ padding: "4px 0" }}>{Math.round(t.elevation_gain).toLocaleString()} m gain</td>
    </tr>
  );
}

/**
 * Async server component: Strava's own recent / year-to-date / all-time totals,
 * fetched live and not stored. Renders nothing unless there is data.
 */
export async function StravaTotalsSection({
  admin,
  userId,
}: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
}) {
  const result = await loadStravaTotals({ admin, userId });
  if (result.status !== "ok") return null;

  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Your Strava totals</p>
      {result.sports.map((s) => (
        <div key={s.sport} style={{ marginTop: 8 }}>
          <p style={{ fontSize: 13, color: "var(--ink-subtle)", marginBottom: 2 }}>{SPORT_LABEL[s.sport]}</p>
          <table style={{ fontSize: 13, borderCollapse: "collapse" }}>
            <tbody>
              <Row label="Last 4 weeks" t={s.recent} />
              <Row label="This year" t={s.ytd} />
              <Row label="All time" t={s.all} />
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
