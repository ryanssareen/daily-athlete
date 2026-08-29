import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getUserWithRoles } from "@/auth/roles";
import { AppearanceThemeButtons } from "@/components/appearance-theme-buttons";

// ---------- Sub-components ------------------------------------------------

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
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
        <p className="eyebrow">{title}</p>
      </div>
      <div style={{ padding: "20px 24px" }}>{children}</div>
    </div>
  );
}

// ---------- Page ----------------------------------------------------------

export default async function CoachSettingsPage() {
  const session = await getUserWithRoles();
  if (!session) redirect("/sign-in");

  const cookieStore = await cookies();
  const theme = cookieStore.get("da2-theme")?.value ?? "light";
  const email = session.user.email ?? "";

  return (
    <div style={{ maxWidth: 640 }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--color-ink)",
            margin: 0,
          }}
        >
          Settings
        </h1>
        <p style={{ color: "var(--color-ink-muted)", marginTop: 6, fontSize: 15 }}>
          Manage your account preferences.
        </p>
      </div>

      {/* Appearance */}
      <SectionCard title="Appearance">
        <p style={{ fontSize: 14, color: "var(--color-ink-muted)", marginBottom: 14 }}>
          Choose your preferred color theme.
        </p>
        <AppearanceThemeButtons initialTheme={theme} />
      </SectionCard>

      {/* Account */}
      <SectionCard title="Account">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <p className="eyebrow" style={{ marginBottom: 2 }}>
              Email
            </p>
            <p style={{ fontSize: 15, color: "var(--color-ink)", margin: 0 }}>{email}</p>
          </div>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              style={{
                padding: "7px 16px",
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                border: "1px solid var(--color-border-strong)",
                background: "transparent",
                color: "var(--color-ink-muted)",
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </SectionCard>
    </div>
  );
}
