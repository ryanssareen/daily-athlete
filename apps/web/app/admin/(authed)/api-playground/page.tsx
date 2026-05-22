// /admin/api-playground -- invoke an allow-listed, non-destructive admin
// endpoint and view its live response, as the operator. Thin server shell; the
// allow-list is defined server-side and passed to the client panel. Every
// invocation the panel makes is audited by /api/admin/playground.

import { publicEndpoints } from "@/admin/playground";

import { PlaygroundPanel } from "./_components/playground-panel";

export const dynamic = "force-dynamic";

export default function ApiPlaygroundPage() {
  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 22, color: "var(--color-ink)" }}>
        API Playground
      </h1>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-ink-muted)" }}>
        Invoke an allow-listed, read-only admin endpoint as yourself. Requests run
        through the admin gate with your session; every call is audited.
      </p>
      <PlaygroundPanel endpoints={publicEndpoints()} />
    </div>
  );
}
