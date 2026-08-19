// /unsubscribe — the confirmation page a digest email's unsubscribe link opens.
//
// OUTSIDE every authed route group, deliberately: there is no session on this
// request and the athlete must not be bounced to sign-in to stop receiving
// email. The token in the URL carries the (narrow) authority.
//
// This page only RENDERS. The state change happens on an explicit click, which
// POSTs to /api/unsubscribe — see that route's header for why a bare GET must
// not mutate anything (mail clients and link scanners pre-fetch email URLs).

import { UnsubscribeConfirm } from "@/components/unsubscribe-confirm";

export const dynamic = "force-dynamic";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; cadence?: string }>;
}) {
  const { token, cadence } = await searchParams;

  const label = cadence === "monthly" ? "monthly" : "weekly";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--color-canvas, #fff)",
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: "100%",
          background: "var(--color-paper, #fff)",
          border: "1px solid var(--color-border, #e5e5e5)",
          borderRadius: 16,
          padding: "32px 28px",
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, color: "var(--color-ink, #111)" }}>
          Unsubscribe
        </h1>

        {!token ? (
          <p style={{ marginTop: 12, fontSize: 15, color: "var(--color-ink-muted, #666)" }}>
            This link is missing its unsubscribe code. Please use the link from the bottom of one of
            your emails, or change your preferences in the app under Settings.
          </p>
        ) : (
          <UnsubscribeConfirm token={token} cadenceLabel={label} />
        )}
      </div>
    </main>
  );
}
