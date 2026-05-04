type Props = {
  params: Promise<{ id: string }>;
};

export default async function AthleteWorkoutDetailPage({ params }: Props) {
  const { id } = await params;
  return (
    <div>
      <h1 style={{ marginBottom: 8 }}>Workout</h1>
      <p style={{ color: "var(--ink-subtle)", marginBottom: 24 }}>ID: {id}</p>
      <p style={{ color: "var(--ink-subtle)" }}>
        Workout detail and completion land with Units 2.4 and 3.3.
      </p>
    </div>
  );
}
