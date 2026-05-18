import MapSection from "./MapSection";

/**
 * Wraps the existing Leaflet RouteMap in the redesigned rounded card chrome
 * with a subtle attribution pill. The map fills the card. We deliberately
 * skip the design's elevation-profile strip — we have no time-series
 * elevation data in `summary_stats`, only a single `total_elevation_gain`.
 */
export function MapCard({ polyline }: { polyline: string }) {
  return (
    <div className="wd-map-card">
      <div className="wd-map-inner">
        <MapSection polyline={polyline} />
      </div>
      <div className="wd-map-attr">ROUTE · STRAVA</div>
    </div>
  );
}

export function MapEmpty({ isStrava }: { isStrava: boolean }) {
  return (
    <div className="wd-map-empty">
      <span style={{ fontSize: 28 }}>📍</span>
      <div style={{ textAlign: "center" }}>
        <p style={{ margin: "0 0 2px", fontWeight: 500, color: "var(--color-ink)" }}>
          No route map yet
        </p>
        {isStrava && (
          <p style={{ margin: 0, fontSize: 12 }}>
            Hit “Sync from Strava” above to pull the latest data
          </p>
        )}
      </div>
    </div>
  );
}
