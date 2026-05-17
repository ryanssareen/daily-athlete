export default function CalendarLoading() {
  return (
    <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
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
          <div className="skeleton" style={{ width: 200, height: 28 }} />
          <div className="skeleton" style={{ width: 140, height: 14 }} />
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
          marginBottom: 24,
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
                padding: "12px 12px 10px",
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
                minHeight: 200,
                padding: "10px 8px",
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

      {/* Analytics rail */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div>
          <div className="skeleton" style={{ width: 110, height: 11, marginBottom: 10 }} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
            }}
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                style={{
                  background: "var(--color-paper)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 12,
                  padding: "14px 18px",
                  minHeight: 84,
                }}
              >
                <div className="skeleton" style={{ width: 70, height: 10, marginBottom: 6 }} />
                <div className="skeleton" style={{ width: 80, height: 22, marginBottom: 4 }} />
                <div className="skeleton" style={{ width: 50, height: 10 }} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="skeleton" style={{ width: 70, height: 11, marginBottom: 10 }} />
          <div
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <div className="skeleton" style={{ width: "60%", height: 12, marginBottom: 6 }} />
                <div className="skeleton" style={{ width: "100%", height: 6, borderRadius: 999 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
