// Tests for the managed-backup Management API client. MSW-mocks api.supabase.com
// (no DB, no live Supabase). Env (token + ref) is set so the configured path is
// exercised; the unconfigured guard is a trivial early return.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SUPABASE_MANAGEMENT_TOKEN = "mgmt-token-stub";
  process.env.SUPABASE_PROJECT_REF = "abcdefghijklmnop";
});

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { getManagedBackupStatus } from "../managed-backups";

const ENDPOINT =
  "https://api.supabase.com/v1/projects/abcdefghijklmnop/database/backups";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("getManagedBackupStatus", () => {
  it("returns ok with parsed fields when the API returns backups", async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json({
          region: "us-east-1",
          walg_enabled: false,
          pitr_enabled: true,
          backups: [
            { status: "COMPLETED", inserted_at: "2026-05-19T03:00:00Z" },
            { status: "COMPLETED", inserted_at: "2026-05-20T03:00:00Z" },
          ],
        })
      )
    );
    expect(await getManagedBackupStatus()).toMatchObject({
      state: "ok",
      pitrEnabled: true,
      region: "us-east-1",
      backupCount: 2,
      latestBackupAt: "2026-05-20T03:00:00Z",
    });
  });

  it("treats an empty backups list (Free tier) as ok with count 0", async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json({ pitr_enabled: false, backups: [] })
      )
    );
    expect(await getManagedBackupStatus()).toMatchObject({
      state: "ok",
      backupCount: 0,
      latestBackupAt: null,
      pitrEnabled: false,
    });
  });

  it("returns error with the HTTP status on a 401", async () => {
    server.use(http.get(ENDPOINT, () => new HttpResponse(null, { status: 401 })));
    expect(await getManagedBackupStatus()).toEqual({
      state: "error",
      status: 401,
    });
  });

  it("returns error on a 5xx", async () => {
    server.use(http.get(ENDPOINT, () => new HttpResponse(null, { status: 503 })));
    expect(await getManagedBackupStatus()).toEqual({
      state: "error",
      status: 503,
    });
  });
});
