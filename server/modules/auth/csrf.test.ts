import { describe, expect, it } from "vitest";

import { assertSameOrigin } from "./csrf.ts";

const config = { publicOrigin: "https://skyldig.example" };

function req(method: string, headers: Record<string, string> = {}) {
  return new Request("https://skyldig.example/s/abc/action", { method, headers });
}

describe("assertSameOrigin", () => {
  it("allows safe methods regardless of headers", () => {
    expect(() => assertSameOrigin(req("GET"), config)).not.toThrow();
    expect(() => assertSameOrigin(req("HEAD"), config)).not.toThrow();
    expect(() => assertSameOrigin(req("OPTIONS"), config)).not.toThrow();
  });

  it("allows a POST with Sec-Fetch-Site: same-origin", () => {
    expect(() =>
      assertSameOrigin(req("POST", { "sec-fetch-site": "same-origin" }), config),
    ).not.toThrow();
  });

  it("blocks a POST with Sec-Fetch-Site: cross-site", () => {
    expect(() => assertSameOrigin(req("POST", { "sec-fetch-site": "cross-site" }), config)).toThrow(
      Response,
    );
  });

  it("allows a POST with a matching Origin when Sec-Fetch-Site is absent", () => {
    expect(() =>
      assertSameOrigin(req("POST", { origin: "https://skyldig.example" }), config),
    ).not.toThrow();
  });

  it("blocks a POST with a mismatched Origin when Sec-Fetch-Site is absent", () => {
    expect(() => assertSameOrigin(req("POST", { origin: "https://evil.example" }), config)).toThrow(
      Response,
    );
  });

  it("blocks a POST with neither header present", () => {
    expect(() => assertSameOrigin(req("POST"), config)).toThrow(Response);
  });

  it("throws a 403 Response", async () => {
    try {
      assertSameOrigin(req("POST"), config);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
    }
  });
});
