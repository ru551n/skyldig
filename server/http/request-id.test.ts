import { describe, expect, it } from "vitest";

import { sanitizeRequestId } from "./request-id.ts";

describe("sanitizeRequestId", () => {
  it("accepts a normal id", () => {
    expect(sanitizeRequestId("abc-123.def_456")).toBe("abc-123.def_456");
  });

  it("rejects non-string input", () => {
    expect(sanitizeRequestId(undefined)).toBeNull();
    expect(sanitizeRequestId(["a", "b"])).toBeNull();
    expect(sanitizeRequestId(42)).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(sanitizeRequestId("")).toBeNull();
  });

  it("rejects a value longer than 64 characters", () => {
    expect(sanitizeRequestId("a".repeat(64))).toBe("a".repeat(64));
    expect(sanitizeRequestId("a".repeat(65))).toBeNull();
  });

  it("rejects characters outside [A-Za-z0-9._-]", () => {
    expect(sanitizeRequestId("has space")).toBeNull();
    expect(sanitizeRequestId("has/slash")).toBeNull();
    expect(sanitizeRequestId("has\nnewline")).toBeNull();
    expect(sanitizeRequestId("<script>alert(1)</script>")).toBeNull();
  });
});
