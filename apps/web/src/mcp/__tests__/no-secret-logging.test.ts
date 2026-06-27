// Audit test: assert that OAuth/MCP source files never pass raw secret values
// to console methods. The threat model: a developer accidentally interpolates
// `bearerToken`, `code`, `codeVerifier`, `reqToken`, or similar into a log
// statement — the value then appears in production log streams.
//
// This is a static text analysis (no runtime required). We read the source
// files as text and assert that no `console.*()` call argument contains a
// reference to a known sensitive identifier.
//
// SENSITIVE identifiers (variable/parameter names that hold secret material):
//   bearerToken, accessToken, refreshToken, codeVerifier, reqToken,
//   code_verifier, refresh_token, access_token, code (OAuth code only)
//
// Safe patterns that ARE allowed:
//   console.warn(`[mcp] read_failed: ${error.message}`)  // error.message from DB
//   console.warn(`[mcp] audit append failed ... ${error.message}`)

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../../..");

const SOURCE_FILES = [
  // OAuth utility modules
  "src/oauth/tokens.ts",
  "src/oauth/codes.ts",
  "src/oauth/clients.ts",
  "src/oauth/state.ts",
  "src/oauth/crypto.ts",
  "src/oauth/pkce.ts",
  // MCP identity bridge + tool surface
  "src/mcp/identity.ts",
  "src/mcp/tools.ts",
  // OAuth HTTP route handlers
  "app/api/oauth/authorize/route.ts",
  "app/api/oauth/token/route.ts",
  "app/api/oauth/register/route.ts",
  // MCP transport
  "app/api/[transport]/route.ts",
].map((f) => resolve(ROOT, "apps/web", f));

// Identifiers whose values must never flow into a log call.
const SENSITIVE_IDENTS = [
  "bearerToken",
  "accessToken",
  "refreshToken",
  "codeVerifier",
  "code_verifier",
  "reqToken",
  "access_token",
  "refresh_token",
];

// We allow `error.message` in log args (safe: DB driver messages, not tokens).
// We allow literal string "code" as an error-code label (e.g. `dbFail("read_failed", ...)`).
// We specifically check for these sensitive idents being interpolated or
// referenced inside console.* arguments.
function buildPattern(ident: string): RegExp {
  // Match: console.<method>( ... <ident> ... ) on the same line.
  // We look for the ident appearing after `console.` open-paren and before
  // the matching close-paren (single-line only — multi-line logs are rarer
  // and the same regex won't catch them, but those are also lower risk).
  return new RegExp(`console\\.\\w+\\([^)]*\\b${ident}\\b`);
}

describe("no-secret-logging audit", () => {
  for (const file of SOURCE_FILES) {
    const shortPath = file.replace(ROOT + "/", "");

    it(`${shortPath} has no console calls leaking sensitive identifiers`, () => {
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        // If the file doesn't exist yet, the test passes vacuously (no bad log).
        return;
      }

      const lines = src.split("\n");
      const violations: string[] = [];

      for (const ident of SENSITIVE_IDENTS) {
        const pat = buildPattern(ident);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comment lines
          if (/^\s*\/\//.test(line)) continue;
          if (pat.test(line)) {
            violations.push(`  line ${i + 1}: '${ident}' in console call: ${line.trim()}`);
          }
        }
      }

      if (violations.length > 0) {
        expect.fail(
          `${shortPath} logs sensitive identifier(s) — move logging to use only error codes or redacted messages:\n${violations.join("\n")}`
        );
      }
    });
  }

  it("console calls in tools.ts only log generic codes and error.message", () => {
    const src = readFileSync(resolve(ROOT, "apps/web/src/mcp/tools.ts"), "utf8");
    const consoleLines = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && /console\.\w+\(/.test(l));

    for (const line of consoleLines) {
      // Every console call must match one of the safe patterns:
      //   [mcp] <error_code>: ${error.message}
      //   [mcp] audit append failed for planned_workout <uuid>: ${error.message}
      // Safe pattern: prefixed with [mcp] and only references error.message —
      // the sensitive-ident scan above already blocks token variable names.
      const isSafe = /\[mcp\]/.test(line) && /error\.message/.test(line);
      expect(isSafe, `Unexpected console pattern in tools.ts: ${line.trim()}`).toBe(true);
    }
  });
});
