export default function DashboardLoading() {
  return (
    <div style={{ maxWidth: 800 }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div className="skeleton" style={{ width: 240, height: 28, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 180, height: 16 }} />
      </div>

      {/* Week stats */}
      <div style={{ marginBottom: 40 }}>
        <div className="skeleton" style={{ width: 70, height: 12, marginBottom: 14 }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[0, 1, 2].map((i) => (
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

      {/* Recent activity */}
      <div>
        <div className="skeleton" style={{ width: 100, height: 12, marginBottom: 14 }} />
        <div
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 20px",
                borderBottom: i < 4 ? "1px solid var(--color-border)" : "none",
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
      </div>
    </div>
  );
}
