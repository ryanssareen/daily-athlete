export default function ActivitiesLoading() {
  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 32 }}>
        <div className="skeleton" style={{ width: 140, height: 28, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 200, height: 16 }} />
      </div>

      {[0, 1].map((group) => (
        <div key={group} style={{ marginBottom: 32 }}>
          <div className="skeleton" style={{ width: 90, height: 12, marginBottom: 12 }} />
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
                  <div className="skeleton" style={{ width: 70, height: 11 }} />
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div className="skeleton" style={{ width: 50, height: 14 }} />
                  <div className="skeleton" style={{ width: 40, height: 22, borderRadius: 999 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
