"use client";

import { useState } from "react";

import { createClient } from "@/auth/supabase";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/roster` },
    });
    if (error) {
      setErrorMsg(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  };

  return (
    <main style={{ maxWidth: 420, margin: "120px auto", padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Coach sign-in</h1>
      <p style={{ color: "var(--ink-subtle)", marginBottom: 24 }}>
        We&apos;ll email you a sign-in link.
      </p>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          type="email"
          value={email}
          required
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border)",
            fontSize: 16,
          }}
        />
        <button
          type="submit"
          disabled={status === "sending" || !email}
          style={{
            padding: 12,
            borderRadius: 8,
            background: "var(--brand)",
            color: "white",
            border: "none",
            fontWeight: 600,
            fontSize: 16,
            cursor: "pointer",
            opacity: status === "sending" || !email ? 0.5 : 1,
          }}
        >
          {status === "sending" ? "Sending..." : "Email me a link"}
        </button>
      </form>
      {status === "sent" && (
        <p style={{ marginTop: 16, color: "var(--ink-subtle)" }}>
          Check your inbox for the sign-in link.
        </p>
      )}
      {status === "error" && errorMsg && (
        <p style={{ marginTop: 16, color: "var(--danger)" }}>{errorMsg}</p>
      )}
    </main>
  );
}
