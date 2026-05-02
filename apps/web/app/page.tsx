import Link from "next/link";

export default function LandingPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>DA2</h1>
      <p style={{ color: "var(--ink-subtle)", fontSize: 18, marginBottom: 32 }}>
        AI-paced training for endurance athletes. Coaches get a web editor; athletes
        train on iOS and Android.
      </p>
      <Link
        href="/sign-in"
        style={{
          display: "inline-block",
          padding: "12px 20px",
          background: "var(--brand)",
          color: "white",
          borderRadius: 8,
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Coach sign-in
      </Link>
    </main>
  );
}
