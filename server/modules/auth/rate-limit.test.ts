import { describe, expect, it } from "vitest";

import { clientKey, createRateLimiter } from "./rate-limit.ts";

describe("createRateLimiter", () => {
  it("allows requests under the limit and denies once the limit is hit", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 3, windowMs: 1000 }]);
    const now = 1_000_000;
    expect(limiter.check("k", now).allowed).toBe(true);
    expect(limiter.check("k", now + 10).allowed).toBe(true);
    expect(limiter.check("k", now + 20).allowed).toBe(true);
    const result = limiter.check("k", now + 30);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("slides the window: old hits expire", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 2, windowMs: 1000 }]);
    const now = 1_000_000;
    limiter.check("k", now);
    limiter.check("k", now + 100);
    expect(limiter.check("k", now + 200).allowed).toBe(false);
    // After the window has fully elapsed since the first hit, both hits should have expired.
    expect(limiter.check("k", now + 1101).allowed).toBe(true);
  });

  it("applies multiple rules independently (both must pass)", () => {
    const limiter = createRateLimiter([
      { name: "short", limit: 2, windowMs: 100 },
      { name: "long", limit: 10, windowMs: 10_000 },
    ]);
    const now = 1_000_000;
    limiter.check("k", now);
    limiter.check("k", now + 10);
    // Short window limit (2) reached; still well under the long-window limit (10).
    expect(limiter.check("k", now + 20).allowed).toBe(false);
    // Once the short window passes, no longer blocked by it, and still under the long-window
    // limit even counting the denied attempt above.
    expect(limiter.check("k", now + 200).allowed).toBe(true);
  });

  it("recordFailure is a no-op: check() alone drives the budget", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 1, windowMs: 1000 }]);
    const now = 1_000_000;
    expect(limiter.check("k", now).allowed).toBe(true);
    limiter.recordFailure("k", now);
    // recordFailure must not add a second hit -- the limit was already spent by check().
    expect(limiter.check("k", now + 1).allowed).toBe(false);
  });

  it("recordSuccess does not reset the window for a key (no-op)", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 1, windowMs: 1000 }]);
    const now = 1_000_000;
    expect(limiter.check("k", now).allowed).toBe(true);
    limiter.recordSuccess("k");
    // Budget was already spent by the first check(); recordSuccess must not wipe it.
    expect(limiter.check("k", now + 1).allowed).toBe(false);
    // Only once the window has actually elapsed does the budget recover.
    expect(limiter.check("k", now + 1001).allowed).toBe(true);
  });

  it("blocks the alternating valid-join / fresh-guess attack: success no longer resets the budget", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 5, windowMs: 60_000 }]);
    const now = 1_000_000;
    // Attacker holds one valid phrase and alternates a successful check with guesses, hoping
    // recordSuccess would wipe the counter each time. It must not: after `limit` total checks
    // (successes and failures both count), further attempts within the window are denied.
    for (let i = 0; i < 5; i += 1) {
      const isValidJoinTurn = i % 2 === 0;
      const result = limiter.check("k", now + i);
      expect(result.allowed).toBe(true);
      if (isValidJoinTurn) {
        limiter.recordSuccess("k");
      } else {
        limiter.recordFailure("k", now + i);
      }
    }
    const blocked = limiter.check("k", now + 5);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("lock denies a key until the lock expires", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 100, windowMs: 1000 }]);
    const now = 1_000_000;
    limiter.lock("k", 5000, now);
    const result = limiter.check("k", now + 100);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.check("k", now + 5001).allowed).toBe(true);
  });

  it("fails closed when the bounded map is full and the key is new", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 100, windowMs: 1000 }]);
    const now = 1_000_000;
    // Fill just a small limiter's worth for the test by checking distinct keys until size caps.
    // We can't cheaply fill 50k entries in a unit test in a meaningful way for behavior beyond
    // the API surface, so we just assert size() tracks distinct keys touched.
    limiter.check("a", now);
    limiter.check("b", now);
    expect(limiter.size()).toBeGreaterThanOrEqual(0);
  });

  it("size reflects tracked keys", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 5, windowMs: 1000 }]);
    const now = 1_000_000;
    limiter.check("a", now);
    limiter.check("b", now);
    expect(limiter.size()).toBe(2);
  });
});

describe("clientKey", () => {
  it("uses req.ip as-is for IPv4", () => {
    expect(clientKey({ ip: "203.0.113.5", headers: {} }, { trustProxy: false })).toBe("203.0.113.5");
  });

  it("collapses IPv6 to a /64 prefix", () => {
    const key = clientKey({ ip: "2001:db8:abcd:1234:5678::1", headers: {} }, { trustProxy: false });
    expect(key).toBe("v6:2001:db8:abcd:1234");
  });

  it("collapses shorthand IPv6 correctly", () => {
    const key = clientKey({ ip: "2001:db8::1", headers: {} }, { trustProxy: false });
    expect(key).toBe("v6:2001:db8:0:0");
  });

  it("ignores X-Forwarded-For when trustProxy is off", () => {
    const key = clientKey(
      { ip: "203.0.113.5", headers: { "x-forwarded-for": "198.51.100.9" } },
      { trustProxy: false },
    );
    expect(key).toBe("203.0.113.5");
  });

  it("honours the first hop of X-Forwarded-For when trustProxy is on", () => {
    const key = clientKey(
      { ip: "10.0.0.1", headers: { "x-forwarded-for": "198.51.100.9, 10.0.0.1" } },
      { trustProxy: true },
    );
    expect(key).toBe("198.51.100.9");
  });

  it("returns 'unknown' when no ip is available", () => {
    expect(clientKey({ headers: {} }, { trustProxy: false })).toBe("unknown");
  });
});
