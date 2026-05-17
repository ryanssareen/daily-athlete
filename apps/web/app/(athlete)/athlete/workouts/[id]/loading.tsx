export default function WorkoutDetailLoading() {
  return (
    <div style={{ maxWidth: 640 }}>
      {/* Back link */}
      <div className="skeleton" style={{ width: 100, height: 14, marginBottom: 24 }} />

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 8 }} />
          <div className="skeleton" style={{ width: 200, height: 28 }} />
        </div>
        <div className="skeleton" style={{ width: 140, height: 14, marginBottom: 10 }} />
        <div className="skeleton" style={{ width: 60, height: 22, borderRadius: 999 }} />
      </div>

      {/* Primary stats row */}
      <div
        style={{
          background: "var(--color-paper)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
          padding: "20px 24px",
        }}
      >
        <div style={{ display: "flex", gap: 32 }}>
          {[80, 70, 80].map((w, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="skeleton" style={{ width: 40, height: 10 }} />
              <div className="skeleton" style={{ width: w, height: 20 }} />
            </div>
          ))}
        </div>
      </div>

      {/* Secondary section */}
      <div style={{ marginTop: 16 }}>
        <div className="skeleton" style={{ width: 70, height: 10, marginBottom: 8 }} />
        <div
          style={{
            background: "var(--color-paper)",
            border: "1px solid var(--color-border)",
            borderRadius: 16,
            padding: "20px 24px",
          }}
        >
          <div style={{ display: "flex", gap: 32 }}>
            {[60, 60].map((w, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="skeleton" style={{ width: 40, height: 10 }} />
                <div className="skeleton" style={{ width: w, height: 20 }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
