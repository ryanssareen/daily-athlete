export default function CalendarLoading() {
  return (
    <div style={{ width: "100%" }}>
      {/* Header skeleton */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="skeleton" style={{ width: 160, height: 28 }} />
          <div className="skeleton" style={{ width: 120, height: 14 }} />
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
          <div className="skeleton" style={{ width: 64, height: 32, borderRadius: 8 }} />
          <div className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />
        </div>
      </div>

      {/* Grid skeleton */}
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          overflow: "hidden",
          marginBottom: 20,
          background: "var(--color-border)",
        }}
      >
        {/* Day headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0 1px" }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: "var(--color-canvas-soft)",
                padding: "10px 10px 9px",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <div className="skeleton" style={{ width: 28, height: 10, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: 28, height: 22, borderRadius: 6 }} />
            </div>
          ))}
        </div>

        {/* Body cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0 1px" }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              style={{
                background: "var(--color-paper)",
                minHeight: 180,
                padding: "8px 6px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {i % 3 !== 1 && (
                <div className="skeleton" style={{ height: 44, borderRadius: 6 }} />
              )}
              {i % 2 === 0 && (
                <div className="skeleton" style={{ height: 44, borderRadius: 6 }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Stats skeleton */}
      <div style={{ display: "flex", gap: 10 }}>
        {[80, 100, 90].map((w, i) => (
          <div
            key={i}
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              padding: "10px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div className="skeleton" style={{ width: w * 0.6, height: 10 }} />
            <div className="skeleton" style={{ width: w, height: 24 }} />
            <div className="skeleton" style={{ width: 50, height: 10 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
