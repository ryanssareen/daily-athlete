// /admin/api-playground -- invoke an allow-listed, non-destructive admin
// endpoint and view its live response, as the operator. Thin server shell; the
// allow-list is defined server-side and passed to the client panel. Every
// invocation the panel makes is audited by /api/admin/playground.

import { publicEndpoints } from "@/admin/playground";

import { PlaygroundPanel } from "./_components/playground-panel";

export const dynamic = "force-dynamic";

export default function ApiPlaygroundPage() {
  return <PlaygroundPanel endpoints={publicEndpoints()} />;
}
