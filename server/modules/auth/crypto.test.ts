import { scryptSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  generateAdminKey,
  generatePublicId,
  hashVerifier,
  hmacIndex,
  normalizeAdminKey,
  normalizePhrase,
  parseVerifier,
  randomToken,
  sha256,
  verifierNeedsUpgrade,
  verifyVerifier,
} from "./crypto.ts";

const PEPPER = "unit-test-pepper-0123456789abcdef";
const OTHER_PEPPER = "some-other-pepper-0123456789abcdef";

/** Builds a v1 (`scrypt$…`, unpeppered) verifier exactly as the pre-v2 hashVerifier did. */
function legacyVerifier(value: string): string {
  const salt = Buffer.alloc(16, 5);
  const hash = scryptSync(value, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

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
    const stored = await hashVerifier(PEPPER, "correct-horse");
    expect(stored).toMatch(/^scrypt2\$32768\$8\$1\$/);
    expect(stored).toHaveLength(87);
    await expect(verifyVerifier(PEPPER, "correct-horse", stored)).resolves.toBe(true);
    await expect(verifyVerifier(PEPPER, "wrong", stored)).resolves.toBe(false);
  });

  it("produces different salts (and thus different strings) across calls", async () => {
    const a = await hashVerifier(PEPPER, "same-value");
    const b = await hashVerifier(PEPPER, "same-value");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored strings without throwing", async () => {
    await expect(verifyVerifier(PEPPER, "x", "not-a-valid-format")).resolves.toBe(false);
    await expect(verifyVerifier(PEPPER, "x", "scrypt$32768$8$1$")).resolves.toBe(false);
  });
});

describe("verifier versions (v1 legacy vs v2 peppered)", () => {
  it("still verifies a legacy v1 verifier, independent of the pepper", async () => {
    const stored = legacyVerifier("legacy-phrase");
    await expect(verifyVerifier(PEPPER, "legacy-phrase", stored)).resolves.toBe(true);
    await expect(verifyVerifier(OTHER_PEPPER, "legacy-phrase", stored)).resolves.toBe(true);
    await expect(verifyVerifier(PEPPER, "other-phrase", stored)).resolves.toBe(false);
  });

  it("a v2 verifier cannot be verified without the pepper it was created with", async () => {
    const stored = await hashVerifier(PEPPER, "new-phrase");
    await expect(verifyVerifier(PEPPER, "new-phrase", stored)).resolves.toBe(true);
    await expect(verifyVerifier(OTHER_PEPPER, "new-phrase", stored)).resolves.toBe(false);
  });

  it("a v1 string relabelled as v2 (or vice versa) does not verify", async () => {
    const v1 = legacyVerifier("phrase");
    await expect(verifyVerifier(PEPPER, "phrase", v1.replace(/^scrypt\$/, "scrypt2$"))).resolves.toBe(false);
    const v2 = await hashVerifier(PEPPER, "phrase");
    await expect(verifyVerifier(PEPPER, "phrase", v2.replace(/^scrypt2\$/, "scrypt$"))).resolves.toBe(false);
  });

  it("the v2 scrypt input is domain-separated from the lookup index", async () => {
    // If the verifier input were HMAC(pepper, phrase) — the same value as the lookup index —
    // then a v1-style verifier over the raw index bytes would verify. It must not.
    const index = hmacIndex(PEPPER, "phrase");
    const salt = Buffer.alloc(16, 9);
    const hash = scryptSync(index, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const forged = `scrypt2$32768$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
    await expect(verifyVerifier(PEPPER, "phrase", forged)).resolves.toBe(false);
  });

  it("verifierNeedsUpgrade is true only for a valid v1 string", async () => {
    expect(verifierNeedsUpgrade(legacyVerifier("p"))).toBe(true);
    expect(verifierNeedsUpgrade(await hashVerifier(PEPPER, "p"))).toBe(false);
    expect(verifierNeedsUpgrade("scrypt$32768$8$1$")).toBe(false);
    expect(verifierNeedsUpgrade("")).toBe(false);
    expect(verifierNeedsUpgrade("scrypt$1$1$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(43) + "=")).toBe(false);
  });
});

describe("parseVerifier (strict stored-verifier validation)", () => {
  const SALT = Buffer.alloc(16, 1).toString("base64"); // 24 chars, "==" padded
  const HASH = Buffer.alloc(32, 2).toString("base64"); // 44 chars, "=" padded

  function build(
    overrides: Partial<{ version: string; n: string; r: string; p: string; salt: string; hash: string }> = {},
  ): string {
    const f = { version: "scrypt2", n: "32768", r: "8", p: "1", salt: SALT, hash: HASH, ...overrides };
    return [f.version, f.n, f.r, f.p, f.salt, f.hash].join("$");
  }

  it("round-trips a freshly generated verifier", async () => {
    const stored = await hashVerifier(PEPPER, "phrase");
    const parsed = parseVerifier(stored);
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe("scrypt2");
    expect(parsed?.salt).toHaveLength(16);
    expect(parsed?.hash).toHaveLength(32);
  });

  it("accepts a well-formed synthetic verifier of either supported version", () => {
    expect(parseVerifier(build())?.version).toBe("scrypt2");
    expect(parseVerifier(build({ version: "scrypt" }))?.version).toBe("scrypt");
  });

  it("rejects non-string and empty input", () => {
    for (const garbage of [undefined, null, 123, 0, true, {}, [], () => "x", Symbol("s"), 10n, ""]) {
      expect(parseVerifier(garbage)).toBeNull();
    }
  });

  it("rejects wrong field counts", () => {
    expect(parseVerifier("scrypt$32768$8$1$" + SALT)).toBeNull(); // 5 fields
    expect(parseVerifier(build() + "$extra")).toBeNull(); // 7 fields
    expect(parseVerifier(build() + "$")).toBeNull(); // trailing separator
    expect(parseVerifier("$" + build())).toBeNull(); // leading separator
    expect(parseVerifier("not-a-valid-format")).toBeNull();
  });

  it("rejects unknown or differently-cased version tags", () => {
    for (const version of ["argon2id", "bcrypt", "SCRYPT", "scrypt1", "scrypt3", "SCRYPT2", "", " scrypt"]) {
      expect(parseVerifier(build({ version }))).toBeNull();
    }
  });

  it("rejects any N/r/p other than the pinned generating parameters", () => {
    for (const n of ["16384", "65536", "131072", String(2 ** 30), "0", "1", "-32768", "32767"]) {
      expect(parseVerifier(build({ n }))).toBeNull();
    }
    for (const r of ["1", "4", "16", "1000", "0"]) {
      expect(parseVerifier(build({ r }))).toBeNull();
    }
    for (const p of ["2", "1000", "0", "-1"]) {
      expect(parseVerifier(build({ p }))).toBeNull();
    }
  });

  it("rejects numerically-equal but non-canonical parameter spellings (no Number() coercion)", () => {
    for (const n of ["32768.0", "0x8000", "3.2768e4", " 32768", "032768", "32768 ", "+32768"]) {
      expect(parseVerifier(build({ n }))).toBeNull();
    }
    expect(parseVerifier(build({ r: "8.0" }))).toBeNull();
    expect(parseVerifier(build({ p: "1e0" }))).toBeNull();
  });

  it("rejects salts that are truncated, oversized, or not canonical base64", () => {
    expect(parseVerifier(build({ salt: "" }))).toBeNull();
    expect(parseVerifier(build({ salt: SALT.slice(0, 20) }))).toBeNull(); // truncated
    expect(parseVerifier(build({ salt: Buffer.alloc(8).toString("base64") }))).toBeNull(); // 8 bytes
    expect(parseVerifier(build({ salt: Buffer.alloc(24).toString("base64") }))).toBeNull(); // 24 bytes
    expect(parseVerifier(build({ salt: SALT.replace("==", "") }))).toBeNull(); // unpadded
    expect(parseVerifier(build({ salt: SALT.replace("==", "=") }))).toBeNull(); // mis-padded
    // Non-canonical: decodes to 16 bytes but does not re-encode to itself.
    expect(parseVerifier(build({ salt: "AAAAAAAAAAAAAAAAAAAAAB==" }))).toBeNull();
    // base64url alphabet is not accepted.
    expect(parseVerifier(build({ salt: "-_-_-_-_-_-_-_-_-_-_-_==" }))).toBeNull();
    expect(parseVerifier(build({ salt: SALT.slice(0, 21) + "!==" }))).toBeNull();
  });

  it("rejects hashes that are truncated, oversized, or not canonical base64", () => {
    expect(parseVerifier(build({ hash: "" }))).toBeNull();
    expect(parseVerifier(build({ hash: HASH.slice(0, 40) }))).toBeNull(); // truncated
    expect(parseVerifier(build({ hash: Buffer.alloc(16).toString("base64") }))).toBeNull(); // 16 bytes
    expect(parseVerifier(build({ hash: Buffer.alloc(64).toString("base64") }))).toBeNull(); // 64 bytes
    expect(parseVerifier(build({ hash: HASH.replace("=", "") }))).toBeNull(); // unpadded
    expect(parseVerifier(build({ hash: "A".repeat(43) + "B=" }))).toBeNull(); // wrong length (45)
    expect(parseVerifier(build({ hash: "A".repeat(42) + "B=" }))).toBeNull(); // non-canonical
  });

  it("rejects strings over the length cap even when they start well-formed", () => {
    expect(parseVerifier(build({ hash: HASH + "A".repeat(100) }))).toBeNull();
    expect(parseVerifier(build() + "x".repeat(200))).toBeNull();
    expect(parseVerifier("scrypt$" + "9".repeat(1000))).toBeNull();
  });

  it("verifyVerifier returns false (never throws) for every rejected shape", async () => {
    const bad = [
      "",
      build({ n: String(2 ** 30) }),
      build({ p: "1000" }),
      build({ r: "1000" }),
      build({ version: "argon2id" }),
      build({ salt: SALT.slice(0, 20) }),
      build({ hash: HASH.slice(0, 40) }),
      build() + "x".repeat(200),
      "scrypt$32768$8$1$$",
      "$$$$$",
    ];
    for (const stored of bad) {
      await expect(verifyVerifier(PEPPER, "x", stored)).resolves.toBe(false);
    }
    for (const garbage of [undefined, null, 42, {}, []]) {
      await expect(verifyVerifier(PEPPER, "x", garbage as unknown as string)).resolves.toBe(false);
    }
  });

  it("a stored hash of a different length than the derived key is rejected, not compared", async () => {
    // Can only be reached with a well-formed salt and a 32-byte hash, so a different-length
    // hash never reaches timingSafeEqual (which would throw): it is rejected at parse time.
    const stored = await hashVerifier(PEPPER, "phrase");
    const [v, n, r, p, salt] = stored.split("$");
    const short = [v, n, r, p, salt, Buffer.alloc(31, 7).toString("base64")].join("$");
    await expect(verifyVerifier(PEPPER, "phrase", short)).resolves.toBe(false);
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
