import { getUserWithRoles } from "@/auth/roles";

export default async function AthleteProfilePage() {
  const session = await getUserWithRoles();

  return (
    <div>
      <h1 style={{ marginBottom: 16 }}>Profile</h1>
      <p>
        <strong>Email:</strong> {session?.user.email ?? "—"}
      </p>
      <p style={{ color: "var(--ink-subtle)", marginTop: 16 }}>
        Strava connection lives in the mobile app (Unit 2.1).
      </p>
      <form action="/auth/sign-out" method="post" style={{ marginTop: 24 }}>
        <button
          type="submit"
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            background: "var(--surface)",
            color: "var(--danger)",
            border: "1px solid var(--border)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
