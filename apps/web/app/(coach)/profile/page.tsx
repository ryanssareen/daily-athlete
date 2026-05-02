import { createClient } from "@/auth/server";

export default async function CoachProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div>
      <h1 style={{ marginBottom: 16 }}>Profile</h1>
      <p>
        <strong>Email:</strong> {user?.email ?? "—"}
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
