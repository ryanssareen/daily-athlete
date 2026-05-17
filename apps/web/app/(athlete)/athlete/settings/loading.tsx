export default function SettingsLoading() {
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <div className="skeleton" style={{ width: 110, height: 28, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 280, height: 16 }} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: 20,
        }}
      >
        {[180, 140, 160, 140].map((h, i) => (
          <div
            key={i}
            style={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-border)",
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 24px",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <div className="skeleton" style={{ width: 80, height: 11, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: 200, height: 12 }} />
            </div>
            <div style={{ padding: "20px 24px", height: h }} />
          </div>
        ))}
      </div>
    </div>
  );
}
