export default function RosterLoading() {
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div className="skeleton" style={{ width: 64, height: 11, marginBottom: 12 }} />
        <div className="skeleton" style={{ width: 200, height: 28, marginBottom: 10 }} />
        <div className="skeleton" style={{ width: 260, height: 15 }} />
      </div>

      {/* Summary tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 28,
        }}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 16,
              padding: "16px 20px",
            }}
          >
            <div className="skeleton" style={{ width: 80, height: 11, marginBottom: 12 }} />
            <div className="skeleton" style={{ width: 44, height: 28 }} />
          </div>
        ))}
      </div>

      {/* Athlete grid */}
      <div className="skeleton" style={{ width: 70, height: 11, marginBottom: 14 }} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 16,
              padding: "20px 22px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="skeleton" style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: 110, height: 15, marginBottom: 6 }} />
                <div className="skeleton" style={{ width: 150, height: 12 }} />
              </div>
            </div>
            <div style={{ height: 1, background: "var(--color-border)", margin: "16px 0 14px" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div>
                <div className="skeleton" style={{ width: 100, height: 13, marginBottom: 6 }} />
                <div className="skeleton" style={{ width: 70, height: 12 }} />
              </div>
              <div className="skeleton" style={{ width: 28, height: 22 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
