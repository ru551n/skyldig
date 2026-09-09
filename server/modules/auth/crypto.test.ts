import { describe, expect, it } from "vitest";

import {
  generateAdminKey,
  generatePublicId,
  hashVerifier,
  hmacIndex,
  normalizeAdminKey,
  normalizePhrase,
  randomToken,
  sha256,
  verifyVerifier,
} from "./crypto.ts";

describe("randomToken", () => {
  it("produces distinct base64url strings of the expected length", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes base64url-encoded, no padding -> 43 chars.
    expect(a.length).toBe(43);
  });

  it("respects the byte length argument", () => {
    expect(randomToken(16).length).toBe(22);
  });
});

describe("sha256", () => {
  it("is deterministic and matches a known vector", () => {
    const digest = sha256("abc");
    expect(digest.toString("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("hmacIndex", () => {
  it("is deterministic for the same pepper and value", () => {
    const a = hmacIndex("pepper", "value");
    const b = hmacIndex("pepper", "value");
    expect(a.equals(b)).toBe(true);
  });

  it("differs when the pepper or value changes", () => {
    const base = hmacIndex("pepper", "value");
    expect(hmacIndex("other", "value").equals(base)).toBe(false);
    expect(hmacIndex("pepper", "other").equals(base)).toBe(false);
  });
});

describe("hashVerifier / verifyVerifier", () => {
  it("verifies a matching value and rejects a non-matching one", async () => {
    const stored = await hashVerifier("correct-horse");
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$/);
    await expect(verifyVerifier("correct-horse", stored)).resolves.toBe(true);
    await expect(verifyVerifier("wrong", stored)).resolves.toBe(false);
  });

  it("produces different salts (and thus different strings) across calls", async () => {
    const a = await hashVerifier("same-value");
    const b = await hashVerifier("same-value");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored strings without throwing", async () => {
    await expect(verifyVerifier("x", "not-a-valid-format")).resolves.toBe(false);
    await expect(verifyVerifier("x", "scrypt$32768$8$1$")).resolves.toBe(false);
  });
});

describe("generatePublicId", () => {
  it("produces 16-char lowercase ids from the restricted alphabet", () => {
    const id = generatePublicId();
    expect(id).toMatch(/^[abcdefghijkmnpqrstuvwxyz23456789]{16}$/);
  });

  it("produces distinct ids across calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generatePublicId()));
    expect(ids.size).toBe(50);
  });
});

describe("generateAdminKey", () => {
  it("has the admin- prefix and 8 groups of 4 chars", () => {
    const key = generateAdminKey();
    expect(key).toMatch(
      /^admin-[abcdefghijkmnpqrstuvwxyz23456789]{4}(-[abcdefghijkmnpqrstuvwxyz23456789]{4}){7}$/,
    );
  });

  it("produces distinct keys across calls", () => {
    const a = generateAdminKey();
    const b = generateAdminKey();
    expect(a).not.toBe(b);
  });
});

describe("normalizePhrase", () => {
  it("normalizes case, whitespace, and separators to single hyphens", () => {
    expect(normalizePhrase("  Häst Bil.Katt_Hund/Fisk,Ko  ")).toBe("häst-bil-katt-hund-fisk-ko");
  });

  it("collapses runs of separators into one hyphen", () => {
    expect(normalizePhrase("a   b--c..d")).toBe("a-b-c-d");
  });

  it("strips leading and trailing separators", () => {
    expect(normalizePhrase("-a-b-")).toBe("a-b");
    expect(normalizePhrase(", a b .")).toBe("a-b");
  });

  it("applies NFKC normalization", () => {
    // "ﬁ" (U+FB01, ligature) NFKC-normalizes to "fi".
    expect(normalizePhrase("ﬁsk")).toBe("fisk");
  });
});

describe("normalizeAdminKey", () => {
  it("trims, lowercases, and removes whitespace", () => {
    expect(normalizeAdminKey("  ADMIN-AbCd-1234  ")).toBe("admin-abcd-1234");
    expect(normalizeAdminKey("admin- abcd 1234")).toBe("admin-abcd1234");
  });
});
