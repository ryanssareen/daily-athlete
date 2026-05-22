// /admin/api-playground -- invoke an allow-listed, non-destructive admin
// endpoint and view its live response, as the operator. Thin server shell; the
// allow-list is defined server-side and passed to the client panel. Every
// invocation the panel makes is audited by /api/admin/playground.

import { publicEndpoints } from "@/admin/playground";

import { PlaygroundPanel } from "./_components/playground-panel";

export const dynamic = "force-dynamic";

export default function ApiPlaygroundPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header className="page-header">
        <div className="page-header-body">
          <div className="page-eyebrow">Console · API</div>
          <h1 className="page-title">API Playground</h1>
          <p className="page-desc">
            Invoke an allow-listed, read-only admin endpoint as yourself.
            Requests run through the admin gate with your session; every call is
            audited.
          </p>
        </div>
      </header>

      <PlaygroundPanel endpoints={publicEndpoints()} />
    </div>
  );
}
