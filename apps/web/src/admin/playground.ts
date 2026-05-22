// Server-side allow-list for the admin API playground. This is the ONLY set of
// endpoints the playground can invoke -- the client sends an endpoint *id*,
// never a URL or path. Every entry is a non-destructive GET that already
// enforces requireAdmin downstream. Adding an entry here is the deliberate,
// reviewable act of exposing an endpoint to the playground.
//
// This module holds NO secrets and never touches the service-role client: it is
// pure metadata + pure query-building. All privileged work (gate, CSRF,
// dispatch, audit) lives in app/api/admin/playground/route.ts.

export type ParamType = "string" | "int";

export interface ParamSpec {
  name: string;
  type: ParamType;
  label: string;
  placeholder?: string;
  /** Inclusive bounds for `int` params; ignored for strings. */
  min?: number;
  max?: number;
}

export interface PlaygroundEndpoint {
  /** Stable id the client sends; also the dispatch key in the route. */
  id: string;
  label: string;
  description: string;
  method: "GET";
  /** Fixed canonical path. NEVER built from client input. */
  path: string;
  params: ParamSpec[];
}

// Non-destructive reads only. Deliberately excludes /api/admin/backups/[id]/
// download (read-only but mints a signed URL to a PII-bearing dump) and every
// state-changing route.
export const PLAYGROUND_ENDPOINTS: readonly PlaygroundEndpoint[] = [
  {
    id: "users",
    label: "List users",
    description: "Read-only user directory (name + email), searchable + paginated.",
    method: "GET",
    path: "/api/admin/users",
    params: [
      { name: "q", type: "string", label: "Search (name or email)", placeholder: "alice" },
      { name: "page", type: "int", label: "Page", placeholder: "0", min: 0 },
      { name: "pageSize", type: "int", label: "Page size", placeholder: "25", min: 1, max: 100 },
    ],
  },
  {
    id: "backups",
    label: "List backups",
    description: "Export artifacts, newest first.",
    method: "GET",
    path: "/api/admin/backups",
    params: [],
  },
  {
    id: "backups.status",
    label: "Backup status",
    description: "Managed Supabase backup + PITR status.",
    method: "GET",
    path: "/api/admin/backups/status",
    params: [],
  },
] as const;

export function findEndpoint(id: string): PlaygroundEndpoint | undefined {
  return PLAYGROUND_ENDPOINTS.find((e) => e.id === id);
}

/**
 * Build a whitelisted query string for an endpoint from raw client params.
 * Only params declared in the endpoint's spec are honored -- everything else is
 * dropped. Strings are trimmed (empty => omitted); ints are parsed, ignored if
 * non-numeric, and clamped to [min, max]. Returns "" or "?...".
 */
export function buildQuery(
  endpoint: PlaygroundEndpoint,
  raw: Record<string, unknown>
): string {
  const out = new URLSearchParams();
  for (const spec of endpoint.params) {
    const value = raw[spec.name];
    if (value === undefined || value === null) continue;

    if (spec.type === "string") {
      const s = String(value).trim();
      if (s) out.set(spec.name, s);
      continue;
    }

    // int: parse, drop garbage, clamp.
    const n = Number(String(value).trim());
    if (!Number.isFinite(n)) continue;
    let i = Math.trunc(n);
    if (spec.min !== undefined) i = Math.max(spec.min, i);
    if (spec.max !== undefined) i = Math.min(spec.max, i);
    out.set(spec.name, String(i));
  }
  const qs = out.toString();
  return qs ? `?${qs}` : "";
}

/** Client-safe projection passed to the panel (no internal path/method). */
export interface PublicEndpoint {
  id: string;
  label: string;
  description: string;
  params: ParamSpec[];
}

export function publicEndpoints(): PublicEndpoint[] {
  return PLAYGROUND_ENDPOINTS.map(({ id, label, description, params }) => ({
    id,
    label,
    description,
    params: params.map((p) => ({ ...p })),
  }));
}
