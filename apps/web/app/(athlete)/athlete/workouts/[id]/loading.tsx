export default function WorkoutDetailLoading() {
  return (
    <div className="wd-container">
      {/* Topbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="skeleton" style={{ width: 100, height: 14 }} />
        <div className="skeleton" style={{ width: 130, height: 32, borderRadius: 999 }} />
      </div>

      {/* Eyebrow */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div className="skeleton" style={{ width: 60, height: 12 }} />
        <div className="skeleton" style={{ width: 50, height: 12 }} />
        <div className="skeleton" style={{ width: 180, height: 12 }} />
      </div>

      {/* Title */}
      <div className="skeleton" style={{ width: "70%", height: 56, borderRadius: 8 }} />

      {/* Headline grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 24,
          padding: "28px 0 24px",
          borderTop: "1px solid var(--color-border)",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="skeleton" style={{ width: 70, height: 10 }} />
            <div className="skeleton" style={{ width: 120, height: 44, borderRadius: 6 }} />
          </div>
        ))}
      </div>

      {/* Secondary grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 16 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="skeleton" style={{ width: 60, height: 10 }} />
            <div className="skeleton" style={{ width: 70, height: 18 }} />
          </div>
        ))}
      </div>

      {/* Map */}
      <div className="skeleton" style={{ width: "100%", height: 380, borderRadius: 16 }} />
    </div>
  );
}
