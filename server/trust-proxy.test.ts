import { once } from "node:events";
import type { AddressInfo } from "node:net";

import express from "express";
import { afterAll, describe, expect, it } from "vitest";

import { clientKey } from "./modules/auth/rate-limit.ts";
import { parseTrustProxy } from "./trust-proxy.ts";

describe("parseTrustProxy", () => {
  it("treats unset / empty / false / 0 as 'trust nothing'", () => {
    for (const v of [undefined, "", "  ", "false", "0"]) expect(parseTrustProxy(v)).toBe(false);
  });

  it("maps 'true' to exactly one trusted hop, never 'trust every hop'", () => {
    expect(parseTrustProxy("true")).toBe(1);
  });

  it("accepts a hop count", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("2")).toBe(2);
  });

  it("accepts keyword / IP / CIDR lists and normalises whitespace", () => {
    expect(parseTrustProxy("loopback")).toBe("loopback");
    expect(parseTrustProxy(" loopback , 10.0.0.0/8 ,fd00::/8, 192.168.1.10 ")).toBe(
      "loopback,10.0.0.0/8,fd00::/8,192.168.1.10",
    );
  });

  it("rejects anything Express would either crash on or silently misread", () => {
    for (const v of ["yes", "on", "-1", "1.5", "10.0.0.0/33", "2001:db8::/129", "loopback,bogus", "10.0.0"]) {
      expect(() => parseTrustProxy(v), v).toThrow(/TRUST_PROXY/);
    }
  });
});

/**
 * End-to-end through a real Express app: the rate-limit key must come from Express's own
 * `req.ip` under the parsed `trust proxy` setting. The test client connects from loopback,
 * which plays the role of "the reverse proxy" for the trusted-hop cases.
 */
describe("clientKey through Express trust proxy", () => {
  const servers: Array<ReturnType<express.Express["listen"]>> = [];
  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  });

  async function keyFor(setting: string | undefined, xff?: string): Promise<{ key: string; ip: string }> {
    const app = express();
    const trust = parseTrustProxy(setting);
    if (trust !== false) app.set("trust proxy", trust);
    app.get("/", (req, res) => {
      res.json({ key: clientKey({ ip: req.ip }), ip: req.ip ?? "" });
    });
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      headers: xff ? { "x-forwarded-for": xff } : {},
    });
    return (await res.json()) as { key: string; ip: string };
  }

  it("direct connection, no proxy trust: key is the socket peer", async () => {
    const { key } = await keyFor(undefined);
    expect(["127.0.0.1", "v6:0:0:0:0", "v6:::ffff:127.0.0.1"]).toContain(key);
    expect(key).not.toBe("unknown");
  });

  it("spoofed X-Forwarded-For with proxy trust disabled is ignored", async () => {
    const direct = await keyFor(undefined);
    const spoofed = await keyFor(undefined, "203.0.113.99");
    expect(spoofed.key).toBe(direct.key);
    expect(spoofed.key).not.toContain("203.0.113.99");
  });

  it("one trusted reverse proxy: the hop the proxy appended is the client; the client's own entry is not", async () => {
    // A real proxy appends the peer it saw: "<whatever client sent>, <real client>".
    const { key } = await keyFor("true", "203.0.113.99, 198.51.100.7");
    expect(key).toBe("198.51.100.7");
    expect((await keyFor("1", "203.0.113.99, 198.51.100.7")).key).toBe("198.51.100.7");
  });

  it("attacker XFF passing through a trusted proxy does not change the key", async () => {
    const honest = await keyFor("1", "198.51.100.7");
    const spoofing = await keyFor("1", "1.1.1.1, 2.2.2.2, 3.3.3.3, 198.51.100.7");
    expect(spoofing.key).toBe(honest.key);
    expect(honest.key).toBe("198.51.100.7");
  });

  it("two trusted hops: the second-from-right entry is the client, further-left entries are ignored", async () => {
    const { key } = await keyFor("2", "9.9.9.9, 198.51.100.7, 10.0.0.2");
    expect(key).toBe("198.51.100.7");
  });

  it("CIDR trust list that excludes loopback: the socket peer is the key even with XFF", async () => {
    const withoutProxy = await keyFor("10.0.0.0/8", "198.51.100.7");
    const direct = await keyFor(undefined);
    expect(withoutProxy.key).toBe(direct.key);
  });

  it("'loopback' keyword trusts the test proxy", async () => {
    expect((await keyFor("loopback", "198.51.100.7")).key).toBe("198.51.100.7");
  });

  it("IPv6 client behind a trusted proxy is keyed by its /64", async () => {
    const a = await keyFor("1", "2001:db8:abcd:1234:aaaa::1");
    const b = await keyFor("1", "2001:db8:abcd:1234:bbbb::2");
    expect(a.key).toBe("v6:2001:db8:abcd:1234");
    expect(b.key).toBe(a.key);
    expect((await keyFor("1", "2001:db8:abcd:9999::1")).key).not.toBe(a.key);
  });
});
