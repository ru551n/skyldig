import { describe, expect, it } from "vitest";

import { resolveRedirectTarget } from "./redirect-target.ts";

const config = { publicOrigin: "http://localhost:3000" };

describe("resolveRedirectTarget", () => {
  it("accepts a normal same-path redirect", () => {
    expect(resolveRedirectTarget("/s/abc123", config)).toBe("/s/abc123");
  });

  it("preserves query and hash on a same-path redirect", () => {
    expect(resolveRedirectTarget("/join?x=1#y", config)).toBe("/join?x=1#y");
  });

  it("rejects a protocol-relative URL (//evil.example)", () => {
    expect(resolveRedirectTarget("//evil.example", config)).toBe("/");
  });

  it("rejects a backslash variant that browsers normalize off-origin (/\\evil.example)", () => {
    expect(resolveRedirectTarget("/\\evil.example", config)).toBe("/");
  });

  it("rejects an absolute URL to a different origin", () => {
    expect(resolveRedirectTarget("https://evil.example", config)).toBe("/");
  });

  it("does not get fooled by percent-encoded slashes (/%2F%2Fevil.example)", () => {
    // Stays same-origin (the encoded slashes are just an odd same-origin path), so it is
    // accepted as-is -- unlike raw "//evil.example", it never resolves off-origin.
    expect(resolveRedirectTarget("/%2F%2Fevil.example", config)).toBe("/%2F%2Fevil.example");
  });

  it("accepts a same-origin absolute URL, normalized down to path + search + hash", () => {
    expect(resolveRedirectTarget("http://localhost:3000/foo?x=1#y", config)).toBe("/foo?x=1#y");
  });

  it("falls back to / for missing, empty, or non-string input", () => {
    expect(resolveRedirectTarget(undefined, config)).toBe("/");
    expect(resolveRedirectTarget(null, config)).toBe("/");
    expect(resolveRedirectTarget("", config)).toBe("/");
    expect(resolveRedirectTarget(42, config)).toBe("/");
  });

  it("falls back to / for an unparseable value", () => {
    expect(resolveRedirectTarget("http://", config)).toBe("/");
  });
});
