export default function ActivitiesLoading() {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div className="skeleton" style={{ width: 130, height: 28 }} />
      </div>

      {/* Filter tabs skeleton */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {[56, 44, 52, 44, 72, 68].map((w, i) => (
          <div key={i} className="skeleton" style={{ width: w, height: 30, borderRadius: 999 }} />
        ))}
      </div>

      <div
        style={{
          background: "var(--color-paper)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {/* Header row */}
        <div
          style={{
            padding: "8px 20px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-canvas-soft)",
            height: 32,
          }}
        />
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "56px 36px 1fr repeat(5, minmax(80px, 100px))",
              alignItems: "center",
              gap: 12,
              padding: "11px 20px",
              borderBottom: i < 7 ? "1px solid var(--color-border)" : "none",
            }}
          >
            <div>
              <div className="skeleton" style={{ width: 44, height: 13, marginBottom: 4 }} />
              <div className="skeleton" style={{ width: 30, height: 10 }} />
            </div>
            <div className="skeleton" style={{ width: 32, height: 32, borderRadius: "50%" }} />
            <div>
              <div className="skeleton" style={{ width: 120, height: 13, marginBottom: 4 }} />
              <div className="skeleton" style={{ width: 80, height: 10 }} />
            </div>
            {[0, 1, 2, 3, 4].map((j) => (
              <div key={j} style={{ textAlign: "right" }}>
                <div className="skeleton" style={{ width: 52, height: 13, marginBottom: 4, marginLeft: "auto" }} />
                <div className="skeleton" style={{ width: 36, height: 9, marginLeft: "auto" }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
