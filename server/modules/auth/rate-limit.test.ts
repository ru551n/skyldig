import { describe, expect, it } from "vitest";

import {
  MAX_KEYS,
  checkClientThenSession,
  checkThenGlobal,
  clientKey,
  createRateLimiter,
} from "./rate-limit.ts";

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

  it("fails closed when the bounded map is full: new keys are denied, tracked keys still work, size never exceeds MAX_KEYS", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 100, windowMs: 60_000 }]);
    const now = 1_000_000;
    for (let i = 0; i < MAX_KEYS; i += 1) {
      limiter.check(`k${i}`, now);
    }
    expect(limiter.size()).toBe(MAX_KEYS);

    // A never-seen key is refused outright (reason "limit", so a lock-arming caller treats it
    // as a plain denial), and it is NOT admitted into the map.
    const fresh = limiter.check("newcomer", now + 1);
    expect(fresh.allowed).toBe(false);
    expect(fresh.reason).toBe("limit");
    expect(fresh.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.size()).toBe(MAX_KEYS);

    // Every already-tracked key keeps its own budget — capacity pressure never punishes them.
    expect(limiter.check("k0", now + 2).allowed).toBe(true);
    expect(limiter.check(`k${MAX_KEYS - 1}`, now + 2).allowed).toBe(true);
    expect(limiter.size()).toBe(MAX_KEYS);

    // Hammering with more unique keys still does not grow memory.
    for (let i = 0; i < 1000; i += 1) {
      expect(limiter.check(`flood${i}`, now + 3).allowed).toBe(false);
    }
    expect(limiter.size()).toBe(MAX_KEYS);
  });

  it("lock() on an untracked key at capacity does not grow the map past MAX_KEYS", () => {
    const limiter = createRateLimiter([{ name: "r", limit: 1, windowMs: 60_000 }]);
    const now = 1_000_000;
    for (let i = 0; i < MAX_KEYS; i += 1) limiter.check(`k${i}`, now);
    expect(limiter.size()).toBe(MAX_KEYS);
    for (let i = 0; i < 100; i += 1) limiter.lock(`locked${i}`, 60_000, now);
    expect(limiter.size()).toBe(MAX_KEYS);
    // ...and the key is still denied (fail closed), just as it was before the lock call.
    expect(limiter.check("locked0", now + 1).allowed).toBe(false);
    // Locking an already-tracked key still works at capacity.
    limiter.lock("k0", 60_000, now);
    expect(limiter.check("k0", now + 1).reason).toBe("locked");
  });

  it("keeps correct per-key counts under an interleaved concurrent burst", async () => {
    const limiter = createRateLimiter([{ name: "r", limit: 10, windowMs: 60_000 }]);
    const now = 1_000_000;
    // 30 "a" and 30 "b" checks, interleaved and scheduled as microtasks so their ordering is
    // as concurrent as a single-threaded event loop allows; the limiter must attribute each
    // hit to exactly its own key.
    const tasks: Promise<{ key: string; allowed: boolean }>[] = [];
    for (let i = 0; i < 60; i += 1) {
      const key = i % 2 === 0 ? "a" : "b";
      tasks.push(
        Promise.resolve().then(() => ({ key, allowed: limiter.check(key, now + i).allowed })),
      );
    }
    const results = await Promise.all(tasks);
    const allowedA = results.filter((r) => r.key === "a" && r.allowed).length;
    const allowedB = results.filter((r) => r.key === "b" && r.allowed).length;
    expect(allowedA).toBe(10);
    expect(allowedB).toBe(10);
    expect(limiter.size()).toBe(2);
    // A third key is completely unaffected by the burst.
    expect(limiter.check("c", now + 100).allowed).toBe(true);
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

  it("an abusive client can never charge the global bucket beyond its own per-client limit", () => {
    // Shapes mirror limiters.join / joinGlobal: 60/h per client, 480/h global.
    const perClient = createRateLimiter([{ name: "pc", limit: 60, windowMs: 3_600_000 }]);
    const global = createRateLimiter([{ name: "g", limit: 480, windowMs: 3_600_000 }]);
    const now = 1_000_000;

    let allowed = 0;
    for (let i = 0; i < 5000; i += 1) {
      if (checkThenGlobal(perClient, global, "abuser", "global", now + i).allowed) allowed += 1;
    }
    expect(allowed).toBe(60);

    // The global bucket holds exactly the abuser's per-client limit worth of hits: 60 of 480.
    // Probe it directly — the probe itself is hit 61; remaining headroom is 480 - 61 = 419.
    let headroom = 0;
    while (global.check("global", now + 10_000).allowed) headroom += 1;
    expect(headroom).toBe(480 - 60);

    // Meanwhile an unrelated client, on a fresh limiter pair with the same abuse applied, is
    // completely unaffected and enjoys its full per-client budget.
    const perClient2 = createRateLimiter([{ name: "pc", limit: 60, windowMs: 3_600_000 }]);
    const global2 = createRateLimiter([{ name: "g", limit: 480, windowMs: 3_600_000 }]);
    for (let i = 0; i < 5000; i += 1) checkThenGlobal(perClient2, global2, "abuser", "global", now + i);
    let innocentAllowed = 0;
    for (let i = 0; i < 60; i += 1) {
      if (checkThenGlobal(perClient2, global2, "innocent", "global", now + 6000 + i).allowed) {
        innocentAllowed += 1;
      }
    }
    expect(innocentAllowed).toBe(60);
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

describe("checkClientThenSession", () => {
  const LOCK_MS = 15 * 60_000;
  function make() {
    // Mirrors limiters.elevate (5/10 min per client) and elevatePerSession (20/h per group).
    return {
      perClient: createRateLimiter([{ name: "c", limit: 5, windowMs: 10 * 60_000 }]),
      perSession: createRateLimiter([{ name: "s", limit: 20, windowMs: 60 * 60_000 }]),
    };
  }

  it("does not charge the per-group bucket for a request denied by the per-client check", () => {
    const { perClient, perSession } = make();
    const now = 1_000_000;
    let allowed = 0;
    // One member floods 200 attempts. Before the fix each of them charged the group bucket
    // and armed the 15-minute lock after the 21st; now only the 5 that pass per-client do.
    for (let i = 0; i < 200; i += 1) {
      const r = checkClientThenSession(perClient, perSession, "member-a", "grp", LOCK_MS, now + i);
      if (r.allowed) allowed += 1;
    }
    expect(allowed).toBe(5);
    // The group bucket holds 5 hits of 20 — a second member (other client key) still has the
    // remaining 15, and no lock was armed.
    let otherAllowed = 0;
    for (let i = 0; i < 5; i += 1) {
      const r = checkClientThenSession(perClient, perSession, "member-b", "grp", LOCK_MS, now + 500 + i);
      if (r.allowed) otherAllowed += 1;
    }
    expect(otherAllowed).toBe(5);
    expect(perSession.check("grp", now + 600).reason).toBeUndefined();
  });

  it("arms the group lock only when the per-group rule itself trips, and reports the lock length", () => {
    const { perClient, perSession } = make();
    const now = 1_000_000;
    // Four members each spend their full per-client budget: 20 group hits, at the cap.
    for (const m of ["m1", "m2", "m3", "m4"]) {
      for (let i = 0; i < 5; i += 1) {
        expect(checkClientThenSession(perClient, perSession, m, "grp", LOCK_MS, now + i).allowed).toBe(true);
      }
    }
    // A fifth member's first attempt passes per-client but trips the group rule -> lock armed.
    const tripped = checkClientThenSession(perClient, perSession, "m5", "grp", LOCK_MS, now + 10);
    expect(tripped.allowed).toBe(false);
    expect(tripped.retryAfterMs).toBeGreaterThanOrEqual(LOCK_MS);
    expect(perSession.check("grp", now + 11).reason).toBe("locked");
  });

  it("does not re-arm an existing lock, so it actually expires", () => {
    const { perClient, perSession } = make();
    const now = 1_000_000;
    perSession.lock("grp", LOCK_MS, now);
    // A member keeps trying during the lock, well within their per-client budget.
    const during = checkClientThenSession(perClient, perSession, "m1", "grp", LOCK_MS, now + LOCK_MS - 1000);
    expect(during.allowed).toBe(false);
    expect(during.retryAfterMs).toBeLessThanOrEqual(1000);
    // Just past the original lock expiry the group is usable again — the attempt during the
    // lock must not have pushed the expiry out.
    const after = checkClientThenSession(perClient, perSession, "m1", "grp", LOCK_MS, now + LOCK_MS + 1);
    expect(after.allowed).toBe(true);
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
