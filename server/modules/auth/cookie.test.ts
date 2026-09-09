import { describe, expect, it } from "vitest";

import { buildClearCookie, buildSessionCookie, getCookieName, readSessionToken } from "./cookie.ts";

describe("getCookieName", () => {
  it("uses __Host- prefix when cookieSecure is true", () => {
    expect(getCookieName({ cookieSecure: true })).toBe("__Host-skyldig");
  });

  it("uses plain name when cookieSecure is false", () => {
    expect(getCookieName({ cookieSecure: false })).toBe("skyldig");
  });
});

describe("buildSessionCookie", () => {
  it("includes Secure and __Host- when cookieSecure is true", () => {
    const cookie = buildSessionCookie({ cookieSecure: true }, "tok123");
    expect(cookie).toContain("__Host-skyldig=tok123");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=7776000");
    expect(cookie).toContain("Secure");
  });

  it("omits Secure when cookieSecure is false", () => {
    const cookie = buildSessionCookie({ cookieSecure: false }, "tok123");
    expect(cookie).toContain("skyldig=tok123");
    expect(cookie).not.toContain("Secure");
  });
});

describe("buildClearCookie", () => {
  it("clears with Max-Age=0", () => {
    const cookie = buildClearCookie({ cookieSecure: true });
    expect(cookie).toContain("__Host-skyldig=;");
    expect(cookie).toContain("Max-Age=0");
  });
});

describe("readSessionToken", () => {
  it("returns null when header is absent", () => {
    expect(readSessionToken(null, { cookieSecure: true })).toBeNull();
  });

  it("extracts the token from a single cookie", () => {
    expect(readSessionToken("__Host-skyldig=abc123", { cookieSecure: true })).toBe("abc123");
  });

  it("finds the right cookie among several", () => {
    const header = "foo=bar; skyldig=mytoken; baz=qux";
    expect(readSessionToken(header, { cookieSecure: false })).toBe("mytoken");
  });

  it("returns null when the cookie is not present", () => {
    expect(readSessionToken("foo=bar", { cookieSecure: false })).toBeNull();
  });

  it("returns null for an empty value", () => {
    expect(readSessionToken("skyldig=", { cookieSecure: false })).toBeNull();
  });
});
