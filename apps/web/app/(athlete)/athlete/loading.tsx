export default function DashboardLoading() {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div className="skeleton" style={{ width: 240, height: 28, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 180, height: 16 }} />
      </div>

      {/* Week stats */}
      <div style={{ marginBottom: 28 }}>
        <div className="skeleton" style={{ width: 70, height: 12, marginBottom: 12 }} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                background: "var(--color-paper)",
                border: "1px solid var(--color-border)",
                borderRadius: 16,
                padding: "20px 24px",
              }}
            >
              <div className="skeleton" style={{ width: 60, height: 11, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: 80, height: 36, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: 100, height: 11 }} />
            </div>
          ))}
        </div>
      </div>

      {/* 2-column main area */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* Recent activity */}
        <div
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "14px 20px",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <div className="skeleton" style={{ width: 100, height: 11 }} />
            <div className="skeleton" style={{ width: 60, height: 11 }} />
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 20px",
                borderBottom: i < 5 ? "1px solid var(--color-border)" : "none",
              }}
            >
              <div className="skeleton" style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: 80, height: 14, marginBottom: 6 }} />
                <div className="skeleton" style={{ width: 60, height: 11 }} />
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="skeleton" style={{ width: 50, height: 13, marginBottom: 4 }} />
                <div className="skeleton" style={{ width: 40, height: 11 }} />
              </div>
            </div>
          ))}
        </div>

        {/* Side rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {[0, 1].map((card) => (
            <div
              key={card}
              style={{
                background: "var(--color-paper)",
                border: "1px solid var(--color-border)",
                borderRadius: 16,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <div className="skeleton" style={{ width: 90, height: 11 }} />
              </div>
              <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                {[0, 1, 2].map((j) => (
                  <div key={j} className="skeleton" style={{ height: 28, borderRadius: 6 }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
