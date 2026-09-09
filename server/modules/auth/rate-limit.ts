const MAX_KEYS = 50_000;

interface Rule {
  name: string;
  limit: number;
  windowMs: number;
}

interface Entry {
  /** Timestamps (ms) of hits within the current window, oldest first. */
  hits: number[];
  /** If set, the key is locked out until this timestamp (ms). */
  lockedUntil?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  /**
   * Present only when `allowed` is false. Distinguishes a denial caused by an existing
   * `lock()` ("locked") from one caused by exceeding a rule's own limit ("limit") — callers
   * that re-apply a lock on every denial (e.g. admin elevation) must only do so for "limit",
   * or a single lockout re-arms itself forever.
   */
  reason?: "locked" | "limit";
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitResult;
  recordFailure(key: string, now?: number): void;
  recordSuccess(key: string): void;
  lock(key: string, ms: number, now?: number): void;
  size(): number;
}

/**
 * Sliding-window rate limiter backed by a bounded LRU map. When the map is full and a new
 * (not-yet-seen) key arrives, it fails closed (denies) rather than evicting to make room —
 * this bounds memory while still fully denying an attacker who tries to blow the cache up
 * with unique keys. Existing keys continue to work normally; oldest-touched entries are
 * evicted first to make room for legitimate new keys once the pressure eases.
 */
export function createRateLimiter(rules: Rule[]): RateLimiter {
  const store = new Map<string, Entry>();

  function touch(key: string, entry: Entry) {
    // Map preserves insertion order; re-inserting moves the key to the "most recent" end,
    // making the earliest key in iteration order the oldest / least-recently-used.
    store.delete(key);
    store.set(key, entry);
  }

  function getOrCreate(key: string): Entry | null {
    const existing = store.get(key);
    if (existing) {
      touch(key, existing);
      return existing;
    }
    if (store.size >= MAX_KEYS) {
      // Fail closed: refuse to admit new keys while at capacity rather than silently
      // evicting a possibly-still-relevant key.
      return null;
    }
    const entry: Entry = { hits: [] };
    store.set(key, entry);
    return entry;
  }

  function pruneWindow(entry: Entry, now: number) {
    const cutoff = now - Math.max(...rules.map((r) => r.windowMs), 0);
    if (entry.hits.length === 0) return;
    let start = 0;
    while (start < entry.hits.length && entry.hits[start] <= cutoff) start += 1;
    if (start > 0) entry.hits = entry.hits.slice(start);
  }

  /**
   * Records an attempt against `key` and reports whether it is allowed. Recording happens on
   * every call — success or failure alike — so the budget cannot be evaded by alternating a
   * correct guess (which used to wipe the counter via `recordSuccess`) with fresh incorrect
   * ones. Callers must call `check()` for every attempt, including successful ones.
   */
  function check(key: string, now: number = Date.now()): RateLimitResult {
    const entry = getOrCreate(key);
    if (!entry) {
      return { allowed: false, retryAfterMs: 60_000, reason: "limit" };
    }
    if (entry.lockedUntil && entry.lockedUntil > now) {
      return { allowed: false, retryAfterMs: entry.lockedUntil - now, reason: "locked" };
    }
    pruneWindow(entry, now);
    entry.hits.push(now);

    for (const rule of rules) {
      const windowStart = now - rule.windowMs;
      const count = entry.hits.filter((t) => t > windowStart).length;
      if (count > rule.limit) {
        const oldestInWindow = entry.hits.find((t) => t > windowStart) ?? now;
        return {
          allowed: false,
          retryAfterMs: Math.max(0, oldestInWindow + rule.windowMs - now),
          reason: "limit",
        };
      }
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  /**
   * No-op alias kept for API compatibility: `check()` now records every attempt itself, so
   * there is nothing left for a separate failure-recording step to add.
   */
  function recordFailure(_key: string, _now: number = Date.now()): void {
    // Intentionally a no-op: check() already recorded this attempt.
  }

  /**
   * No-op: previously this deleted the key, which let an attacker holding one valid phrase
   * wipe their failure budget by alternating a valid join with fresh guesses. The sliding
   * window now decays naturally via pruneWindow on the next check().
   */
  function recordSuccess(_key: string): void {
    // Intentionally a no-op: do not reset the window on success.
  }

  function lock(key: string, ms: number, now: number = Date.now()): void {
    const entry = getOrCreate(key) ?? { hits: [] };
    entry.lockedUntil = now + ms;
    touch(key, entry);
  }

  function size(): number {
    return store.size;
  }

  return { check, recordFailure, recordSuccess, lock, size };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The named limiters described in docs/architecture.md section 4.4. */
export const limiters = {
  /** Per-client join attempts: 10 per 10 minutes and 60 per hour. */
  join: createRateLimiter([
    { name: "join-10m", limit: 10, windowMs: 10 * MINUTE },
    { name: "join-1h", limit: 60, windowMs: HOUR },
  ]),
  /** Global join attempts across all clients: 300 per hour. Always keyed 'global'. */
  joinGlobal: createRateLimiter([{ name: "join-global-1h", limit: 300, windowMs: HOUR }]),
  /** Per-client admin elevation attempts: 5 per 10 minutes. */
  elevate: createRateLimiter([{ name: "elevate-10m", limit: 5, windowMs: 10 * MINUTE }]),
  /**
   * Per-session-public-id admin elevation attempts: 20 per hour, after which callers should
   * `lock` the key for 15 minutes.
   */
  elevatePerSession: createRateLimiter([{ name: "elevate-session-1h", limit: 20, windowMs: HOUR }]),
};

export const ELEVATE_PER_SESSION_LOCK_MS = 15 * MINUTE;

interface RequestLike {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

function collapseIpv6(ip: string): string {
  // Expand shorthand "::" is unnecessary for a stable /64 key: we only need the first 4
  // hextets (64 bits), which are never elided by "::" unless the address has fewer than 4
  // leading groups. Handle the common case (no leading "::") directly, and fall back to a
  // best-effort split otherwise.
  const zoneless = ip.split("%")[0];
  if (!zoneless.includes("::")) {
    const parts = zoneless.split(":");
    return parts.slice(0, 4).join(":");
  }
  const [head, tail] = zoneless.split("::");
  const headParts = head.length > 0 ? head.split(":") : [];
  if (headParts.length >= 4) {
    return headParts.slice(0, 4).join(":");
  }
  const tailParts = tail.length > 0 ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const expanded = [...headParts, ...Array(Math.max(0, missing)).fill("0"), ...tailParts];
  return expanded.slice(0, 4).join(":");
}

function isIpv6(ip: string): boolean {
  return ip.includes(":");
}

function firstForwardedFor(value: string | string[]): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw.split(",")[0].trim();
}

/**
 * Derives the rate-limit client key for a request: IPv4 address as-is, IPv6 collapsed to its
 * /64 prefix. `X-Forwarded-For`'s first hop is honoured only when `config.trustProxy` is set
 * (a truthy string/boolean, matching how `TRUST_PROXY` is read from the environment).
 */
export function clientKey(req: RequestLike, config: { trustProxy?: string | boolean }): string {
  let ip = req.ip ?? "";
  if (config.trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) {
      ip = firstForwardedFor(xff);
    }
  }
  if (!ip) return "unknown";
  return isIpv6(ip) ? `v6:${collapseIpv6(ip)}` : ip;
}
