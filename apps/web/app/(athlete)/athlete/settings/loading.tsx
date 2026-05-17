export default function SettingsLoading() {
  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 32 }}>
        <div className="skeleton" style={{ width: 110, height: 28, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 240, height: 16 }} />
      </div>

      {[180, 120, 100, 80].map((h, i) => (
        <div
          key={i}
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            overflow: "hidden",
            marginBottom: 20,
          }}
        >
          <div
            style={{
              padding: "16px 24px",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <div className="skeleton" style={{ width: 80, height: 11 }} />
          </div>
          <div style={{ padding: "20px 24px", height: h }} />
        </div>
      ))}
    </div>
  );
}
