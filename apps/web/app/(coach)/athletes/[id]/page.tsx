type Props = {
  params: Promise<{ id: string }>;
};

export default async function AthleteDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>Athlete</h1>
      <p style={{ color: "var(--ink-subtle)", marginBottom: 24 }}>ID: {id}</p>
      <p style={{ color: "var(--ink-subtle)" }}>
        Plan editor and comments land in Phase 4 of the implementation plan.
      </p>
    </div>
  );
}
