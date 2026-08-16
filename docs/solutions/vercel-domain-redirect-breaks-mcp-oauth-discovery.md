---
title: Vercel Domain Redirects Break MCP/OAuth Metadata Discovery
date: 2026-08-16
status: active
---

# Vercel Domain Redirects Break MCP/OAuth Metadata Discovery

Why the Daily-Athlete MCP connector failed to connect from claude.ai, and
the general pitfall: never point an MCP/OAuth client (or its docs) at a
domain that's configured to redirect, even when that domain works fine for
ordinary browser navigation.

## The bug

Adding the connector in claude.ai failed instantly with
`oauth_error=non_standard&oauth_error_subtype=provider_redirect` — no
consent screen, no login prompt, just an immediate failure toast
("Authorization with Daily Athlete failed").

## Root cause

The connector was configured with the bare apex domain,
`https://thedailyathlete.in`. In Vercel (Project → Settings → Domains),
that domain was set to **"Redirect to Another Domain"** — a 307 to
`https://www.thedailyathlete.in`, applying to every path on the domain
including `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`.

```
curl -sI https://thedailyathlete.in/.well-known/oauth-protected-resource
HTTP/2 307
location: https://www.thedailyathlete.in/.well-known/oauth-protected-resource
```

`www.thedailyathlete.in` itself served correct, self-consistent metadata —
the app code was never the problem. But RFC 9728 §3.1 expects
`.well-known` metadata served directly at the resource's own origin, and
MCP/OAuth clients are not required to follow a redirect when fetching it.
Claude's client didn't — it surfaced the redirect as a hard discovery
failure instead of transparently following it the way a browser would.

## What didn't work

Pointing the connector at `https://www.thedailyathlete.in/api/mcp` instead
of the apex domain worked around the symptom immediately, but left the
underlying misconfiguration in place — anyone who later copied the
"obvious" bare-domain URL (from memory, from a search result, from an old
doc) would hit the exact same failure again.

## The fix

Fixed the redirect itself, in Vercel → Project → Settings → Domains:
`thedailyathlete.in` → Edit → switched from **"Redirect to Another
Domain"** to **"Connect to an environment" → Production**. All three
project domains (`thedailyathlete.in`, `www.thedailyathlete.in`, and the
`*.vercel.app` URL) now serve Production directly, with no redirects
between them — `.well-known` metadata resolves identically no matter which
one a client is pointed at.

## Why this works

MCP/OAuth discovery is a strict, spec-driven client — it's checking that
metadata lives exactly where the spec says it should, not doing the
lenient "eventually resolves to a 200" following that a browser or a
regular HTTP client does. A redirect that's completely invisible in normal
browser use (an SEO-motivated apex→www canonicalization, for instance) is
a hard failure for this class of client. The fix has to be "the domain
doesn't redirect at all," not "point the docs/config at whichever domain
happens not to redirect right now" — the latter is a landmine for the next
person who reaches for the other domain.

## Prevention

- Before wiring an MCP server, an OAuth client, or any spec-driven
  discovery-based integration to a domain, check whether that domain is
  configured to redirect (`curl -sI <domain>/.well-known/<whatever>` —
  look for a 3xx) — not just whether it loads in a browser.
- If a project has multiple domains pointing at the same deployment (an
  apex + www + a platform-generated URL, as is typical on Vercel), pick
  one canonical domain for anything discovery-based to reference, and make
  sure that specific domain is never the one configured to redirect.
- `docs/operational/mcp-connector.md` now documents this pitfall directly
  in its "Connect Claude.ai" section, alongside the working connector URL.
