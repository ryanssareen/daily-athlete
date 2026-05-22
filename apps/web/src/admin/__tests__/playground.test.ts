// Unit tests for the playground allow-list helpers -- the security-relevant
// param whitelisting/coercion that keeps client input off the wire untouched.

import { describe, expect, it } from "vitest";

import {
  buildQuery,
  findEndpoint,
  PLAYGROUND_ENDPOINTS,
  publicEndpoints,
} from "@/admin/playground";

const users = findEndpoint("users")!;

describe("findEndpoint", () => {
  it("resolves a known id and rejects an unknown one", () => {
    expect(findEndpoint("users")?.path).toBe("/api/admin/users");
    expect(findEndpoint("nope")).toBeUndefined();
    expect(findEndpoint("../backups/route")).toBeUndefined();
  });

  it("only exposes non-destructive GET endpoints", () => {
    for (const e of PLAYGROUND_ENDPOINTS) {
      expect(e.method).toBe("GET");
      expect(e.path.startsWith("/api/admin/")).toBe(true);
    }
  });
});

describe("buildQuery", () => {
  it("drops params not declared in the endpoint spec", () => {
    expect(buildQuery(users, { evil: "1; DROP TABLE", q: "ok" })).toBe("?q=ok");
  });

  it("trims strings and omits empties", () => {
    expect(buildQuery(users, { q: "  alice  " })).toBe("?q=alice");
    expect(buildQuery(users, { q: "   " })).toBe("");
  });

  it("parses ints, drops non-numeric, and truncates", () => {
    expect(buildQuery(users, { page: "3" })).toBe("?page=3");
    expect(buildQuery(users, { page: "2.9" })).toBe("?page=2");
    expect(buildQuery(users, { page: "abc" })).toBe("");
  });

  it("clamps ints to their declared bounds", () => {
    expect(buildQuery(users, { pageSize: "99999" })).toBe("?pageSize=100");
    expect(buildQuery(users, { pageSize: "0" })).toBe("?pageSize=1");
    expect(buildQuery(users, { page: "-5" })).toBe("?page=0");
  });

  it("returns an empty string for an endpoint with no params", () => {
    expect(buildQuery(findEndpoint("backups")!, { anything: "x" })).toBe("");
  });
});

describe("publicEndpoints", () => {
  it("projects display metadata (method/path/group/auth/params) for the catalog UI", () => {
    const pub = publicEndpoints();
    expect(pub.map((e) => e.id)).toEqual(PLAYGROUND_ENDPOINTS.map((e) => e.id));
    for (const e of pub) {
      expect(e.method).toBe("GET");
      expect(e.path.startsWith("/api/admin/")).toBe(true);
      expect(e.group).toBeTruthy();
      expect(e.auth).toBeTruthy();
    }
  });
});
