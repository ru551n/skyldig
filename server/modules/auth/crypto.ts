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

const VERIFIER_VERSION = "scrypt";
// Bounds for a stored verifier string. A valid one is exactly 86 chars
// (`scrypt$32768$8$1$` + 24-char salt + `$` + 44-char hash); the cap just needs to be above that.
const VERIFIER_MAX_LENGTH = 128;
// Canonical standard base64 (with padding) for exactly 16 and exactly 32 bytes.
const SALT_B64_RE = /^[A-Za-z0-9+/]{22}==$/;
const HASH_B64_RE = /^[A-Za-z0-9+/]{43}=$/;

export interface ParsedVerifier {
  version: typeof VERIFIER_VERSION;
  salt: Buffer;
  hash: Buffer;
}

/**
 * Decodes a base64 field that must be canonical and decode to exactly `bytes` bytes. Node's
 * base64 decoder is lenient (skips invalid chars, tolerates missing padding), so the charset is
 * checked up front and the decoded value is re-encoded and compared to the input.
 */
function decodeBase64Exact(field: string, shape: RegExp, bytes: number): Buffer | null {
  if (!shape.test(field)) return null;
  const buf = Buffer.from(field, "base64");
  if (buf.length !== bytes) return null;
  if (buf.toString("base64") !== field) return null;
  return buf;
}

/**
 * Strictly parses a stored verifier string, or returns `null` for anything that is not exactly
 * the shape `hashVerifier` produces: known version tag, N/r/p equal (as decimal strings, no
 * `Number()` coercion) to the pinned generating parameters, canonical base64 salt of exactly
 * `SCRYPT_SALT_BYTES` and hash of exactly `SCRYPT_KEYLEN`. Never throws. Because the
 * parameters are pinned, a corrupt or hostile row can neither pick the scrypt cost nor force
 * an allocation beyond the fixed 128*N*r = 32 MiB (`SCRYPT_MAXMEM` bounds it regardless).
 */
export function parseVerifier(stored: unknown): ParsedVerifier | null {
  if (typeof stored !== "string") return null;
  if (stored.length === 0 || stored.length > VERIFIER_MAX_LENGTH) return null;
  const parts = stored.split("$");
  if (parts.length !== 6) return null;
  const [version, nStr, rStr, pStr, saltB64, hashB64] = parts;
  if (version !== VERIFIER_VERSION) return null;
  if (nStr !== String(SCRYPT_N) || rStr !== String(SCRYPT_R) || pStr !== String(SCRYPT_P)) return null;
  const salt = decodeBase64Exact(saltB64, SALT_B64_RE, SCRYPT_SALT_BYTES);
  const hash = decodeBase64Exact(hashB64, HASH_B64_RE, SCRYPT_KEYLEN);
  if (!salt || !hash) return null;
  return { version, salt, hash };
}

/** Derives a scrypt hash of `value`, encoded as `scrypt$N$r$p$saltB64$hashB64`. */
export async function hashVerifier(value: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scryptAsync(value, salt, SCRYPT_KEYLEN, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return `${VERIFIER_VERSION}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/**
 * Verifies `value` against a `hashVerifier`-produced string in constant time. Malformed or
 * unsupported stored strings yield `false` without running scrypt and without throwing.
 */
export async function verifyVerifier(value: string, stored: string): Promise<boolean> {
  const parsed = parseVerifier(stored);
  if (!parsed) return false;
  let derived: Buffer;
  try {
    derived = await scryptAsync(value, parsed.salt, parsed.hash.length, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  } catch {
    return false;
  }
  // Both are fixed at SCRYPT_KEYLEN by construction; the length check keeps timingSafeEqual
  // from throwing should that ever change.
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
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
