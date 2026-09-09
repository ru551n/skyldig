import { isIP } from "node:net";

/**
 * Value handed to Express's `trust proxy` setting: `false` (nothing trusted), a hop count, or
 * a comma-separated list of `loopback` / `linklocal` / `uniquelocal` / IP / CIDR entries.
 */
export type TrustProxySetting = false | number | string;

const KEYWORDS = new Set(["loopback", "linklocal", "uniquelocal"]);

function isCidr(value: string): boolean {
  const slash = value.indexOf("/");
  if (slash === -1) return false;
  const ip = value.slice(0, slash);
  const bits = Number(value.slice(slash + 1));
  const family = isIP(ip);
  if (family === 0 || !Number.isInteger(bits) || bits < 0) return false;
  return bits <= (family === 4 ? 32 : 128);
}

/**
 * Parses `TRUST_PROXY` into Express's native `trust proxy` setting, so the client IP used for
 * rate-limit keys is always Express's own `req.ip` — resolved by walking `X-Forwarded-For` from
 * the right (the socket peer) and stopping at the first untrusted hop. Whatever an external
 * client puts in the header is therefore ignored unless every proxy between it and this app is
 * trusted, which is the property the rate limiter needs (docs/architecture.md §4.4).
 *
 * Accepted values:
 * - unset / empty / `false` / `0`: nothing is trusted; `req.ip` is the socket peer address.
 * - `true`: exactly one proxy in front of the app is trusted (hop count 1). Never "trust every
 *   hop": that would make the leftmost, client-supplied XFF entry the client IP.
 * - an integer `N`: the `N` nearest hops are trusted (`2` for e.g. Cloudflare → nginx → app).
 * - a comma-separated list of `loopback`, `linklocal`, `uniquelocal`, IPv4/IPv6 addresses or
 *   CIDR ranges: those peers are trusted, anything else is where the chain stops.
 *
 * Anything else is a configuration error (thrown at startup): silently falling back would
 * either disable rate limiting per client (trust everything) or mis-attribute every request to
 * the proxy (trust nothing) without the operator noticing.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = (raw ?? "").trim();
  if (value === "" || value === "false" || value === "0") return false;
  if (value === "true") return 1;
  if (/^[1-9]\d*$/.test(value)) return Number(value);
  const entries = value
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (entries.length === 0) return false;
  for (const entry of entries) {
    if (KEYWORDS.has(entry) || isIP(entry) !== 0 || isCidr(entry)) continue;
    throw new Error(
      `Invalid environment configuration:\n  - TRUST_PROXY: "${entry}" is not a hop count, true/false, loopback/linklocal/uniquelocal, an IP address or a CIDR range`,
    );
  }
  return entries.join(",");
}
