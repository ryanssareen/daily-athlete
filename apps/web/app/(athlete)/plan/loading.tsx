import { cardStyle as card } from "@/plan/plan-card-style";

function Bar({ width, height = 12 }: { width: string; height?: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 6,
        background: "var(--color-border)",
        marginBottom: 10,
      }}
    />
  );
}

export default function PlanLoading() {
  return (
    <div
      data-testid="plan-loading"
      role="status"
      aria-label="Loading your plan"
      style={{ width: "100%", padding: "8px 0 80px" }}
    >
      <div style={card}>
        <Bar width="90%" />
        <Bar width="75%" />
        <Bar width="40%" />
      </div>
      <div style={card}>
        <Bar width="50%" height={22} />
        <Bar width="30%" />
        <Bar width="100%" height={6} />
      </div>
      <div style={card}>
        <Bar width="20%" />
        <Bar width="60%" />
      </div>
      <div style={card}>
        <Bar width="25%" />
        <Bar width="100%" height={40} />
        <Bar width="100%" height={40} />
      </div>
    </div>
  );
}
