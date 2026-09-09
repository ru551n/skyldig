/**
 * Upper bound on distinct keys a single limiter tracks. Exported for tests only — the value is
 * a memory bound, not a tunable.
 */
export const MAX_KEYS = 50_000;

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

  /**
   * Locks `key` until `now + ms`. When the map is at capacity and `key` is not yet tracked,
   * this is a no-op: `check()` already denies every untracked key at capacity (see
   * `getOrCreate`), so the lock would add nothing — and inserting past the bound (which an
   * earlier version did via a detached entry) would let repeated `lock()` calls grow the map
   * without limit, defeating the whole point of the bound.
   */
  function lock(key: string, ms: number, now: number = Date.now()): void {
    const entry = getOrCreate(key);
    if (!entry) return;
    entry.lockedUntil = now + ms;
  }

  function size(): number {
    return store.size;
  }

  return { check, recordFailure, recordSuccess, lock, size };
}

export interface CombinedRateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Checks a per-client limiter and a global (all-clients) limiter together, the way every
 * route that has both must: check the per-client limiter FIRST, and only check (and thereby
 * record a hit against) the global limiter if the per-client check already passed.
 *
 * `check()` records a hit on every call, including denied ones (see its doc comment) — that
 * is correct and intentional for the per-client budget, but checking the global limiter
 * unconditionally means a single client denied by its own per-client cap still spends a hit
 * out of the shared global budget on every one of its rejected requests. A flood from one
 * client can then drain the entire global budget through denied requests alone, locking out
 * every *other* client even though none of the flood's requests ever succeeded — the global
 * limiter, meant as a last-resort circuit breaker against a botnet spread across many client
 * keys, becomes itself the denial-of-service. A request that never passes the per-client
 * check must consume none of the global budget.
 */
export function checkThenGlobal(
  perClient: RateLimiter,
  global: RateLimiter,
  key: string,
  globalKey = "global",
  now?: number,
): CombinedRateLimitResult {
  const clientResult = perClient.check(key, now);
  if (!clientResult.allowed) {
    return { allowed: false, retryAfterMs: clientResult.retryAfterMs };
  }
  const globalResult = global.check(globalKey, now);
  if (!globalResult.allowed) {
    return { allowed: false, retryAfterMs: globalResult.retryAfterMs };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * The admin-elevation counterpart of `checkThenGlobal`: a per-client limiter composed with a
 * per-group (session public id) limiter that arms a lock once its rule trips. Same ordering
 * rule, same reason: the per-client check runs FIRST, and the per-group bucket is only checked
 * (and thereby only charged) when the per-client check passed. Checking both unconditionally
 * — as `app/routes/session/admin.tsx` did before this — let one member who had already
 * exhausted their own 5/10 min budget keep charging the group's 20/h bucket with every denied
 * request, reaching the 15-minute group-wide lock in seconds and shutting every legitimate
 * admin of that group out of elevating. The lock is armed only when the per-group denial is
 * caused by the rule itself (`reason === "limit"`), never by an existing lock, or every
 * attempt during the lock would re-arm it and it would never expire.
 */
export function checkClientThenSession(
  perClient: RateLimiter,
  perSession: RateLimiter,
  clientKey: string,
  sessionKey: string,
  lockMs: number,
  now?: number,
): CombinedRateLimitResult {
  const clientResult = perClient.check(clientKey, now);
  if (!clientResult.allowed) {
    return { allowed: false, retryAfterMs: clientResult.retryAfterMs };
  }
  const sessionResult = perSession.check(sessionKey, now);
  if (!sessionResult.allowed) {
    if (sessionResult.reason === "limit") {
      perSession.lock(sessionKey, lockMs, now);
      return { allowed: false, retryAfterMs: Math.max(sessionResult.retryAfterMs, lockMs) };
    }
    return { allowed: false, retryAfterMs: sessionResult.retryAfterMs };
  }
  return { allowed: true, retryAfterMs: 0 };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The named limiters described in docs/architecture.md section 4.4. */
export const limiters = {
  /**
   * Per-client join attempts: 20 per 10 minutes and 60 per hour.
   *
   * Deliberately generous, because the product's normal case is a whole group joining the
   * same trip from one shared network, so every one of them presents the same client key.
   * A tight per-client cap would lock out a legitimate group before it inconveniences an
   * attacker, who simply uses more addresses.
   *
   * The global cap below is what actually bounds brute force. A join is resolved by a single
   * blind-index lookup, so one guess is tested against every active group at once; with a
   * 4-word phrase (44.5 bits) and 240 attempts an hour, even a million live groups take
   * around a decade before one hit is expected, and ten thousand groups take over a
   * millennium.
   */
  join: createRateLimiter([
    { name: "join-10m", limit: 20, windowMs: 10 * MINUTE },
    { name: "join-1h", limit: 60, windowMs: HOUR },
  ]),
  /**
   * Global join attempts across all clients: 480 per hour. Always keyed 'global', and only
   * ever checked (via `checkThenGlobal`) for a request that already passed the per-client
   * `join` check — see that function's doc comment for why checking it unconditionally would
   * let one client's flood of already-denied requests drain the shared budget and lock out
   * every other client, which is itself a denial-of-service.
   *
   * At 480 attempts/hour against a 4-word phrase (44.5 bits), a million live groups are still
   * roughly half a decade from an expected hit and ten thousand groups several centuries —
   * this is a last-resort circuit breaker against a botnet spread across many client keys
   * (each individually bounded by the much tighter per-client cap above), not the primary
   * brute-force defense, so it is sized to comfortably absorb bursts of genuine multi-tenant
   * traffic rather than to be the tightest number that still "works" mathematically.
   */
  joinGlobal: createRateLimiter([{ name: "join-global-1h", limit: 480, windowMs: HOUR }]),
  /**
   * Invite-token redemption is a separate credential surface from the reusable access
   * phrase (see docs/todo.md "Share a group by QR code or link"): a token is single-use,
   * short-lived and revocable, so it does not need — and must not share — the phrase's
   * budget. Sharing one budget between them means an attack (or, in testing, a deliberate
   * exhaustion of the join limiter) on one surface wrongly blocks the other for the same
   * client. Sized the same as `join`/`joinGlobal` for now, since the risk profile is similar.
   */
  invite: createRateLimiter([
    { name: "invite-10m", limit: 20, windowMs: 10 * MINUTE },
    { name: "invite-1h", limit: 60, windowMs: HOUR },
  ]),
  /**
   * Global invite-token attempts across all clients: 240 per hour. Always keyed 'global', and,
   * like `joinGlobal`/`createSessionGlobal`, only ever checked (via `checkThenGlobal`) for a
   * request that already passed the per-client `invite` check — see `checkThenGlobal`'s doc
   * comment for why checking it unconditionally would let one client's already-denied
   * requests alone drain the shared budget.
   */
  inviteGlobal: createRateLimiter([{ name: "invite-global-1h", limit: 240, windowMs: HOUR }]),
  /**
   * Per-client live exchange-rate lookups (server/modules/fx/rate-provider.ts): 30 per minute.
   * Generous but real — this guards against a runaway client loop or deliberate abuse of the
   * app as a free relay to Frankfurter, not credential guessing, so it is sized very
   * differently from `join`/`invite` and kept in its own bucket for the same reason those two
   * are kept separate from each other.
   */
  fx: createRateLimiter([{ name: "fx-1m", limit: 30, windowMs: MINUTE }]),
  /** Per-client admin elevation attempts: 5 per 10 minutes. */
  elevate: createRateLimiter([{ name: "elevate-10m", limit: 5, windowMs: 10 * MINUTE }]),
  /**
   * Per-session-public-id admin elevation attempts: 20 per hour, after which the key is locked
   * for `ELEVATE_PER_SESSION_LOCK_MS` (15 minutes). Only ever checked via
   * `checkClientThenSession`, i.e. after the per-client `elevate` check passed, so a client can
   * charge this bucket at most 5 hits per 10 minutes.
   *
   * Accepted trade-off: this bucket is keyed by the group, so any *member* of the group (a
   * grant is required before the limiter is touched — `requireSessionAccess` in
   * `app/routes/session/admin.tsx` runs first, and an outsider who merely knows the public id
   * gets a 404 without spending anything) can, by sustaining wrong guesses for ~40 minutes from
   * one client key or faster from several, lock every legitimate admin of that same group out
   * of elevating for 15 minutes. That nuisance is confined to a group the attacker is already
   * inside, whereas without the per-group cap a member behind rotating client keys could guess
   * at the admin key at 5 tries per key per 10 minutes without bound (docs/architecture.md
   * §4.3). Brute-force protection on the admin key wins.
   */
  elevatePerSession: createRateLimiter([{ name: "elevate-session-1h", limit: 20, windowMs: HOUR }]),
  /**
   * Per-client group (session) creation: 18 per 10 minutes and 45 per hour.
   *
   * Unlike `join`, where a whole real group legitimately shares one client key, creating a
   * group is a one-person, one-time action — nobody legitimately spins up a dozen groups from
   * the same network in a short window. So this is sized meaningfully tighter than
   * `join`/`joinGlobal` (20/10min, 60/h) in both windows. It is not as tight as a first pass
   * might suggest, though, because this app's own e2e suite creates around fifteen groups from
   * a single client key (one shared loopback IP, workers: 1) in one run — several spec files
   * each create one as setup, and the accessibility spec's `beforeEach` creates a fresh one for
   * every one of its four tests; the anti-bot spec (`tests/e2e/new-anti-bot.spec.ts`) and the
   * invite-creation rate-limit regression (`tests/e2e/invitecreate-rate-limit.spec.ts`) each add
   * one more. The numbers here leave deliberate headroom above that real, measured usage so a
   * legitimate burst (including this app's own tests, or a small team spinning up a few groups
   * back to back) never trips it, while still cutting a scripted flood down hard compared to
   * `join`.
   */
  createSession: createRateLimiter([
    { name: "create-session-10m", limit: 18, windowMs: 10 * MINUTE },
    { name: "create-session-1h", limit: 45, windowMs: HOUR },
  ]),
  /**
   * Global group-creation attempts across all clients: 500 per hour. Always keyed 'global',
   * and only ever checked (via `checkThenGlobal`) for a request that already passed the
   * per-client `createSession` check — checking it unconditionally, as an earlier version of
   * this code did, let one client's flood of already-denied requests (each still hitting this
   * global bucket) exhaust the entire hour's budget while none of them actually created
   * anything, locking out every real user's first group creation. See `checkThenGlobal`'s doc
   * comment.
   *
   * This is a last-resort circuit breaker against a botnet spreading load across many client
   * keys (each individually bounded by the much tighter 18/10min, 45/h per-client cap above),
   * not a tight budget meant to constrain ordinary traffic — a self-hosted instance with
   * several active teams creating groups back-to-back must never notice it. 500/h comfortably
   * absorbs that (500 is more than 12x the per-client hourly cap, i.e. room for a dozen busy
   * clients at once) while still cutting off a determined flood well short of the point where
   * junk groups (each persisting 90 days, see docs/todo.md) start burdening storage and every
   * admin/backup operation that touches the `sessions` table before cleanup catches up.
   */
  createSessionGlobal: createRateLimiter([{ name: "create-session-global-1h", limit: 500, windowMs: HOUR }]),
};

export const ELEVATE_PER_SESSION_LOCK_MS = 15 * MINUTE;

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

/**
 * Derives the rate-limit client key for a request from Express's resolved `req.ip`: IPv4
 * address as-is, IPv6 collapsed to its /64 prefix. `X-Forwarded-For` is deliberately NOT read
 * here — Express already applied the `trust proxy` setting (server/trust-proxy.ts) when it
 * resolved `req.ip`, walking the header from the proxy side and stopping at the first untrusted
 * hop, so a client cannot mint itself a fresh key by sending its own `X-Forwarded-For`. (Before
 * this, any truthy `TRUST_PROXY` made the *leftmost* — client-controlled — entry the key.)
 */
export function clientKey(req: { ip?: string | undefined }): string {
  const ip = req.ip ?? "";
  if (!ip) return "unknown";
  return isIpv6(ip) ? `v6:${collapseIpv6(ip)}` : ip;
}
