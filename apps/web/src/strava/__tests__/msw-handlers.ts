// msw request handlers for Strava's REST + OAuth endpoints. Reused by
// the B1 StravaClient tests, the B2 connect route tests, and the Phase C/D
// suites (backfill, hydration).
//
// Each handler is parameterized by a tiny in-memory `StravaMockState`
// fixture so tests can scriptedly toggle 200 / 401 / 429 / rate-limit
// shapes. The handlers themselves are static -- tests mutate the shared
// state object.
//
// Why a custom mini-DSL rather than reaching into msw's lower-level API
// each test: every Strava endpoint we mock has the same retry-and-401
// surface, so centralising the "next response" decision here keeps the
// test files small and the failure-mode expressivity high.

import { http, HttpResponse } from "msw";

export type NextResponse =
  | { kind: "ok"; body: unknown; rateLimits?: RateLimitHeaders }
  | { kind: "auth-expired-401"; rateLimits?: RateLimitHeaders }
  | { kind: "rate-limit-401"; rateLimits?: RateLimitHeaders }
  | { kind: "429"; rateLimits?: RateLimitHeaders };

export interface RateLimitHeaders {
  limit: string; // e.g. "100,1000"
  usage: string; // e.g. "5,12"
}

export interface RefreshResponseScripted {
  kind: "ok" | "invalid-grant" | "boom";
  payload?: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };
}

export interface AuthorizeResponseScripted {
  kind: "ok" | "invalid-code" | "boom";
  payload?: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    scope: string;
    athlete: { id: number };
  };
}

export interface StravaMockState {
  /** Queue of scripted responses keyed by Strava REST path (e.g. "/athlete"). */
  apiResponses: Record<string, NextResponse[]>;
  /** Refresh-token endpoint scripted responses (queue). */
  refresh: RefreshResponseScripted[];
  /** Authorization-code exchange scripted responses (queue). */
  authorize: AuthorizeResponseScripted[];
  /** Captured refresh-token POST bodies for assertions. */
  refreshCalls: { refresh_token: string }[];
  /** Captured authorize POST bodies for assertions. */
  authorizeCalls: {
    code: string;
    code_verifier: string;
    redirect_uri: string;
  }[];
}

export function createMockState(): StravaMockState {
  return {
    apiResponses: {},
    refresh: [],
    authorize: [],
    refreshCalls: [],
    authorizeCalls: [],
  };
}

function dequeue<T>(arr: T[]): T | undefined {
  return arr.shift();
}

function applyRateLimitHeaders(
  headers: Headers,
  rateLimits: RateLimitHeaders | undefined
): void {
  if (!rateLimits) return;
  headers.set("X-RateLimit-Limit", rateLimits.limit);
  headers.set("X-RateLimit-Usage", rateLimits.usage);
}

function rateLimit401Body(): unknown {
  return {
    message: "Authorization Error",
    errors: [{ resource: "Application", field: "rate limit", code: "exceeded" }],
  };
}

function authExpired401Body(): unknown {
  return {
    message: "Authorization Error",
    errors: [{ resource: "Athlete", field: "access_token", code: "invalid" }],
  };
}

export function stravaApiHandlers(state: StravaMockState) {
  return [
    // Catch-all for any /api/v3 endpoint -- tests register per-path
    // queues in state.apiResponses.
    http.get("https://www.strava.com/api/v3/*", ({ request }) => {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api\/v3/, "");
      const queue = state.apiResponses[path];
      const next = queue && dequeue(queue);
      if (!next) {
        return new HttpResponse(
          JSON.stringify({ message: `no mock for ${path}` }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
      const headers = new Headers({ "Content-Type": "application/json" });
      applyRateLimitHeaders(headers, next.rateLimits);
      switch (next.kind) {
        case "ok":
          return new HttpResponse(JSON.stringify(next.body), {
            status: 200,
            headers,
          });
        case "auth-expired-401":
          return new HttpResponse(JSON.stringify(authExpired401Body()), {
            status: 401,
            headers,
          });
        case "rate-limit-401":
          return new HttpResponse(JSON.stringify(rateLimit401Body()), {
            status: 401,
            headers,
          });
        case "429":
          return new HttpResponse(
            JSON.stringify({ message: "Too Many Requests" }),
            { status: 429, headers }
          );
      }
    }),

    // OAuth token endpoint. Disambiguates refresh-token vs auth-code calls
    // by grant_type so a single handler covers both.
    http.post(
      "https://www.strava.com/oauth/token",
      async ({ request }) => {
        const body = await request.text();
        const params = new URLSearchParams(body);
        const grantType = params.get("grant_type");

        if (grantType === "refresh_token") {
          state.refreshCalls.push({
            refresh_token: params.get("refresh_token") ?? "",
          });
          const next = dequeue(state.refresh);
          if (!next) {
            return new HttpResponse(
              JSON.stringify({ message: "no refresh mock" }),
              { status: 500 }
            );
          }
          if (next.kind === "ok" && next.payload) {
            return HttpResponse.json({
              ...next.payload,
              token_type: "Bearer",
              expires_in: 21600,
            });
          }
          if (next.kind === "invalid-grant") {
            return new HttpResponse(
              JSON.stringify({
                message: "Bad Request",
                errors: [
                  { resource: "RefreshToken", field: "refresh_token", code: "invalid" },
                ],
              }),
              { status: 400 }
            );
          }
          return new HttpResponse(JSON.stringify({ message: "boom" }), {
            status: 500,
          });
        }

        if (grantType === "authorization_code") {
          state.authorizeCalls.push({
            code: params.get("code") ?? "",
            code_verifier: params.get("code_verifier") ?? "",
            redirect_uri: params.get("redirect_uri") ?? "",
          });
          const next = dequeue(state.authorize);
          if (!next) {
            return new HttpResponse(
              JSON.stringify({ message: "no authorize mock" }),
              { status: 500 }
            );
          }
          if (next.kind === "ok" && next.payload) {
            return HttpResponse.json({
              ...next.payload,
              token_type: "Bearer",
              expires_in: 21600,
            });
          }
          if (next.kind === "invalid-code") {
            return new HttpResponse(
              JSON.stringify({
                message: "Bad Request",
                errors: [
                  { resource: "Application", field: "code", code: "invalid" },
                ],
              }),
              { status: 400 }
            );
          }
          return new HttpResponse(JSON.stringify({ message: "boom" }), {
            status: 500,
          });
        }

        return new HttpResponse(
          JSON.stringify({ message: "unknown grant_type" }),
          { status: 400 }
        );
      }
    ),
  ];
}
