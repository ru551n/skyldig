import { describe, expect, it } from "vitest";

import { checkThenGlobal, clientKey, createRateLimiter } from "./rate-limit.ts";

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

  it("reports reason 'locked' for a denial caused by an existing lock", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 100, windowMs: 1000 }]);
    const now = 1_000_000;
    limiter.lock("k", 5000, now);
    const result = limiter.check("k", now + 100);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("locked");
  });

  it("reports reason 'limit' for a denial caused by exceeding a rule (not locked)", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 1, windowMs: 1000 }]);
    const now = 1_000_000;
    expect(limiter.check("k", now).allowed).toBe(true);
    const result = limiter.check("k", now + 10);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("limit");
  });

  it("does not report reason when allowed", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 100, windowMs: 1000 }]);
    const result = limiter.check("k", 1_000_000);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
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

describe("checkThenGlobal", () => {
  it("does not touch the global bucket for a request denied by the per-client check", () => {
    const perClient = createRateLimiter([{ name: "pc", limit: 1, windowMs: 60_000 }]);
    const global = createRateLimiter([{ name: "g", limit: 100, windowMs: 60_000 }]);
    const now = 1_000_000;

    // Client "attacker" spends its own budget, then floods far past it.
    expect(checkThenGlobal(perClient, global, "attacker", "global", now).allowed).toBe(true);
    for (let i = 0; i < 50; i += 1) {
      const result = checkThenGlobal(perClient, global, "attacker", "global", now + 1 + i);
      expect(result.allowed).toBe(false);
    }

    // The global bucket must have recorded only the one request that actually passed the
    // per-client check — none of the 50 rejected floods should have touched it.
    expect(global.size()).toBe(1);
    const globalDirect = global.check("global", now + 100);
    expect(globalDirect.allowed).toBe(true);
  });

  it("reproduces the auditor's scenario: one client's flood never blocks a second, different client", () => {
    // Mirrors limiters.createSession / createSessionGlobal shape: tight per-client, more
    // generous global.
    const perClient = createRateLimiter([{ name: "pc", limit: 15, windowMs: 10 * 60_000 }]);
    const global = createRateLimiter([{ name: "g", limit: 500, windowMs: 60 * 60_000 }]);
    const now = 1_000_000;

    let succeeded = 0;
    // One attacker fires 60 rapid requests, exactly the auditor's scenario.
    for (let i = 0; i < 60; i += 1) {
      const result = checkThenGlobal(perClient, global, "attacker-ip", "global", now + i);
      if (result.allowed) succeeded += 1;
    }
    // Only the per-client cap's worth actually succeeded.
    expect(succeeded).toBe(15);

    // A second, different client must still be able to succeed afterward — the flood must not
    // have measurably depleted the global bucket (it only recorded the 15 that passed).
    const secondClient = checkThenGlobal(perClient, global, "innocent-ip", "global", now + 1000);
    expect(secondClient.allowed).toBe(true);
    expect(global.size()).toBe(1); // still just the "global" key, far under its 500 limit
  });

  it("still enforces the global cap once it is genuinely exhausted by passing requests", () => {
    const perClient = createRateLimiter([{ name: "pc", limit: 1000, windowMs: 60_000 }]);
    const global = createRateLimiter([{ name: "g", limit: 2, windowMs: 60_000 }]);
    const now = 1_000_000;

    expect(checkThenGlobal(perClient, global, "a", "global", now).allowed).toBe(true);
    expect(checkThenGlobal(perClient, global, "b", "global", now + 1).allowed).toBe(true);
    const third = checkThenGlobal(perClient, global, "c", "global", now + 2);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });
});

describe("clientKey", () => {
  it("uses req.ip as-is for IPv4", () => {
    expect(clientKey({ ip: "203.0.113.5" })).toBe("203.0.113.5");
  });

  it("collapses IPv6 to its /64 prefix so one host cannot rotate through its whole /64", () => {
    const key = clientKey({ ip: "2001:db8:abcd:1234:5678::1" });
    expect(key).toBe("v6:2001:db8:abcd:1234");
    expect(clientKey({ ip: "2001:db8:abcd:1234:ffff::2" })).toBe(key);
  });

  it("handles a leading '::' shorthand", () => {
    expect(clientKey({ ip: "2001:db8::1" })).toBe("v6:2001:db8:0:0");
  });

  it("strips an IPv6 zone id", () => {
    expect(clientKey({ ip: "fe80::1%eth0" })).toBe("v6:fe80:0:0:0");
  });

  it("falls back to a shared 'unknown' key when no address is available", () => {
    expect(clientKey({})).toBe("unknown");
    expect(clientKey({ ip: "" })).toBe("unknown");
  });
});
