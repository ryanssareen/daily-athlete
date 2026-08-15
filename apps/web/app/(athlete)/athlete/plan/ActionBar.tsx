"use client";

import { useState } from "react";

export function ActionBar() {
  const [state, setState] = useState<"idle" | "loading">("idle");

  return (
    <section className="action-bar">
      <button
        className={"btn-done" + (state === "loading" ? " is-loading" : "")}
        disabled={state === "loading"}
        onClick={() => setState("loading")}
      >
        {state === "loading" ? "Saving…" : "✓ Mark as done"}
      </button>
      <button className="btn-secondary">Log a different activity</button>
      <button className="btn-ghost-text">Message coach</button>
    </section>
  );
}
