import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 2 ** 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;

// Lowercase, unambiguous 32-char alphabet (no 0/1/l/o).
const PUBLIC_ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

// 128*N*r bytes are required by scrypt; N=2^15, r=8 needs exactly 32 MiB, which sits right at
// (or just over, with libuv/OpenSSL overhead) Node's 32 MiB default `maxmem`. Raise it so the
// configured parameters actually work.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function scryptAsync(password: string, salt: Buffer, keylen: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, { N: n, r, p, maxmem: SCRYPT_MAXMEM }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** `bytes` cryptographically random bytes, base64url-encoded. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string | Buffer): Buffer {
  return createHash("sha256").update(input).digest();
}

export function hmacIndex(pepper: string, value: string): Buffer {
  return createHmac("sha256", pepper).update(value).digest();
}

/** Derives a scrypt hash of `value`, encoded as `scrypt$N$r$p$saltB64$hashB64`. */
export async function hashVerifier(value: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scryptAsync(value, salt, SCRYPT_KEYLEN, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** Verifies `value` against a `hashVerifier`-produced string in constant time. */
export async function verifyVerifier(value: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, "base64");
    expected = Buffer.from(hashB64, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = await scryptAsync(value, salt, expected.length, n, r, p);
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Maps a random byte to a char in a 32-entry alphabet exactly (256 / 32 = 8, no bias). */
function byteToAlphabetChar(byte: number): string {
  return PUBLIC_ID_ALPHABET[byte % PUBLIC_ID_ALPHABET.length];
}

/**
 * Packs bytes into the 32-char alphabet 5 bits at a time (32 = 2^5, so every char carries a
 * full, unbiased 5 bits with no rejection sampling needed). Used where the byte count and
 * desired char count don't match 1:1, unlike `generatePublicId`.
 */
function encodeBase32(bytes: Buffer): string {
  let bitBuffer = 0;
  let bitCount = 0;
  let out = "";
  for (const byte of bytes) {
    bitBuffer = (bitBuffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      const index = (bitBuffer >>> (bitCount - 5)) & 0b11111;
      out += PUBLIC_ID_ALPHABET[index];
      bitCount -= 5;
    }
  }
  if (bitCount > 0) {
    const index = (bitBuffer << (5 - bitCount)) & 0b11111;
    out += PUBLIC_ID_ALPHABET[index];
  }
  return out;
}

/** 16 lowercase chars from a 32-char alphabet, ~80 bits of entropy. */
export function generatePublicId(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += byteToAlphabetChar(bytes[i]);
  }
  return out;
}

/**
 * `admin-` followed by 8 groups of 4 chars: 20 random bytes (160 bits) base32-encoded 5 bits
 * per char (160 / 5 = 32 chars exactly, no padding).
 */
export function generateAdminKey(): string {
  const bytes = randomBytes(20);
  const chars = encodeBase32(bytes);
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 4) {
    groups.push(chars.slice(i, i + 4));
  }
  return `admin-${groups.join("-")}`;
}

/** NFKC, trim, lowercase, collapse separators to a single hyphen, strip leading/trailing hyphens. */
export function normalizePhrase(input: string): string {
  return input
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s,._/-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Trim, lowercase, strip whitespace (admin keys already contain their own hyphens). */
export function normalizeAdminKey(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, "");
}
