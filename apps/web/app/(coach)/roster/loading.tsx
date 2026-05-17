export default function RosterLoading() {
  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 32 }}>
        <div className="skeleton" style={{ width: 140, height: 28, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 100, height: 16 }} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
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
              padding: "20px 24px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div className="skeleton" style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ width: 100, height: 15, marginBottom: 6 }} />
                <div className="skeleton" style={{ width: 140, height: 12 }} />
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div className="skeleton" style={{ width: 70, height: 12 }} />
                <div className="skeleton" style={{ width: 90, height: 12 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div className="skeleton" style={{ width: 60, height: 12 }} />
                <div className="skeleton" style={{ width: 70, height: 12 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
