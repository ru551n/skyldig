import { describe, expect, it } from "vitest";

import { identityFromHeaders, isTrustedPeer, normalizeIp, parseGroupId } from "./auth.ts";

describe("isTrustedPeer", () => {
  it("matches the proxy's address, including IPv4 on an IPv6 socket", () => {
    expect(normalizeIp("::ffff:192.168.1.10")).toBe("192.168.1.10");
    expect(isTrustedPeer("::ffff:192.168.1.10", ["192.168.1.10"])).toBe(true);
    expect(isTrustedPeer("192.168.1.10", ["::ffff:192.168.1.10"])).toBe(true);
    expect(isTrustedPeer("::1", ["::1"])).toBe(true);
  });

  it("rejects anyone else, and a missing address", () => {
    expect(isTrustedPeer("192.168.1.11", ["192.168.1.10"])).toBe(false);
    expect(isTrustedPeer(undefined, ["192.168.1.10"])).toBe(false);
    expect(isTrustedPeer("", [""])).toBe(false);
  });
});

describe("identityFromHeaders", () => {
  const headers = (username?: string, groups?: string) => ({
    ...(username !== undefined ? { "x-authentik-username": username } : {}),
    ...(groups !== undefined ? { "x-authentik-groups": groups } : {}),
  });

  it("accepts a user in the required group; Authentik separates groups with |", () => {
    expect(identityFromHeaders(headers("alice", "staff|skyldig-admins"), "skyldig-admins")).toEqual({ username: "alice" });
    expect(identityFromHeaders(headers(" alice ", " skyldig-admins "), "skyldig-admins")).toEqual({ username: "alice" });
  });

  it("rejects a missing user, a missing or wrong group, and a partial group-name match", () => {
    expect(identityFromHeaders(headers(undefined, "skyldig-admins"), "skyldig-admins")).toBeNull();
    expect(identityFromHeaders(headers("alice"), "skyldig-admins")).toBeNull();
    expect(identityFromHeaders(headers("alice", "staff"), "skyldig-admins")).toBeNull();
    expect(identityFromHeaders(headers("alice", "skyldig-admins-old"), "skyldig-admins")).toBeNull();
    expect(identityFromHeaders(headers("x".repeat(201), "skyldig-admins"), "skyldig-admins")).toBeNull();
  });
});

describe("parseGroupId", () => {
  const id = "v4rmt49ur4f47jtz";

  it("takes a bare ID or a group link, with or without a sub-page", () => {
    expect(parseGroupId(id)).toBe(id);
    expect(parseGroupId(` ${id} `)).toBe(id);
    expect(parseGroupId(`https://skyldig.nu/s/${id}`)).toBe(id);
    expect(parseGroupId(`https://skyldig.nu/s/${id}/gor-upp?x=1`)).toBe(id);
  });

  it("rejects anything that isn't exactly a group ID", () => {
    expect(parseGroupId("abc")).toBeNull();
    expect(parseGroupId(id.toUpperCase())).toBeNull();
    expect(parseGroupId("v4rmt49ur4f47jt0")).toBeNull(); // 0 is not in the alphabet
    expect(parseGroupId(`${id}x`)).toBeNull();
    expect(parseGroupId(`https://skyldig.nu/i/${id}`)).toBeNull();
    expect(parseGroupId("'; DROP TABLE sessions; --")).toBeNull();
  });
});
