import { timingSafeEqual } from "node:crypto";

import { hmacIndex } from "./crypto.ts";

/**
 * Anti-bot "minimum time on page" token for `app/routes/new.tsx`'s create-group form (finding
 * 4 of the 2026-09 security audit, alongside the honeypot field in the same route). This is
 * NOT a CSRF/authenticity token — origin is already verified by `assertSameOrigin` — it only
 * proves the form being submitted was rendered by this server at least `MIN_AGE_MS` ago. A
 * scripted submission that skips the human fill-in time cannot forge a token with an
 * acceptable age without also waiting, which is the whole point: it costs a bot real wall-clock
 * time to defeat, unlike a honeypot field a careful bot could simply avoid filling in.
 *
 * Token shape: `<timestamp-ms>.<base64url HMAC-SHA256 of the timestamp>`. Reuses
 * `ACCESS_KEY_PEPPER` (`server/config.ts`) as the HMAC secret rather than adding a dedicated
 * one: the pepper is a general server-wide secret not tied to any specific session or
 * credential, and forging a token here requires forging an HMAC under the same secret either
 * way, so reusing it does not weaken its primary job of indexing access phrases. A separate
 * secret would be marginally tidier but isn't worth a new env var for a low-stakes,
 * best-effort anti-bot signal.
 */

const MIN_AGE_MS = 1_500;
const MAX_AGE_MS = 60 * 60 * 1000;

/** Mints a fresh token for the current time, to be embedded as a hidden form field on render. */
export function issueFormToken(secret: string, now: number = Date.now()): string {
  const ts = String(now);
  const mac = hmacIndex(secret, ts).toString("base64url");
  return `${ts}.${mac}`;
}

/**
 * Verifies a submitted token: well-formed, MAC matches (constant-time), and its age is at
 * least `MIN_AGE_MS` (rejects a submission faster than a human could plausibly fill the form)
 * and at most `MAX_AGE_MS` (rejects a stale/replayed token from a long-abandoned tab).
 */
export function verifyFormToken(token: string, secret: string, now: number = Date.now()): boolean {
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const tsStr = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^\d+$/.test(tsStr) || mac.length === 0) return false;

  const expectedMac = hmacIndex(secret, tsStr).toString("base64url");
  const expected = Buffer.from(expectedMac);
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length) return false;
  if (!timingSafeEqual(expected, actual)) return false;

  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;
  const age = now - ts;
  if (age < MIN_AGE_MS) return false;
  if (age > MAX_AGE_MS) return false;
  return true;
}
