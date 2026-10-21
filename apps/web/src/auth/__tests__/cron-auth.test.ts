import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isCronAuthorized } from "../cron-auth";

const req = (auth?: string) =>
  new Request("http://localhost/x", { headers: auth ? { authorization: auth } : {} });

describe("isCronAuthorized", () => {
  const prev = process.env.CRON_SECRET;
  afterEach(() => {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });

  it("fails closed when CRON_SECRET is unset, even for 'Bearer undefined'", () => {
    delete process.env.CRON_SECRET;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(isCronAuthorized(req("Bearer undefined"))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });

  it("accepts only the exact bearer secret", () => {
    process.env.CRON_SECRET = "s3cret";
    expect(isCronAuthorized(req("Bearer s3cret"))).toBe(true);
    expect(isCronAuthorized(req("Bearer s3cre"))).toBe(false);
    expect(isCronAuthorized(req("Bearer other!"))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });
});
