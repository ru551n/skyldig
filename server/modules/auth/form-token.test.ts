import { describe, expect, it } from "vitest";

import { issueFormToken, verifyFormToken } from "./form-token.ts";

const SECRET = "test-secret-pepper-value-1234567890";

describe("form-token", () => {
  it("round-trips a valid token once enough time has passed", () => {
    const now = 1_700_000_000_000;
    const token = issueFormToken(SECRET, now);
    expect(verifyFormToken(token, SECRET, now + 2_000)).toBe(true);
  });

  it("rejects a tampered token (bad MAC)", () => {
    const now = 1_700_000_000_000;
    const token = issueFormToken(SECRET, now);
    const [ts] = token.split(".");
    const tampered = `${ts}.notarealmac`;
    expect(verifyFormToken(tampered, SECRET, now + 2_000)).toBe(false);
  });

  it("rejects a token with a tampered timestamp", () => {
    const now = 1_700_000_000_000;
    const token = issueFormToken(SECRET, now);
    const [, mac] = token.split(".");
    const tampered = `${now + 100_000}.${mac}`;
    expect(verifyFormToken(tampered, SECRET, now + 2_000)).toBe(false);
  });

  it("rejects an expired token (> 1 hour old)", () => {
    const now = 1_700_000_000_000;
    const token = issueFormToken(SECRET, now);
    const oneHourAndOneSecondLater = now + 60 * 60 * 1000 + 1_000;
    expect(verifyFormToken(token, SECRET, oneHourAndOneSecondLater)).toBe(false);
  });

  it("rejects a token submitted too fast (< 1.5s after issuance)", () => {
    const now = 1_700_000_000_000;
    const token = issueFormToken(SECRET, now);
    expect(verifyFormToken(token, SECRET, now + 1_000)).toBe(false);
    expect(verifyFormToken(token, SECRET, now)).toBe(false);
  });

  it("accepts a token right at the minimum age boundary", () => {
    const now = 1_700_000_000_000;
    const token = issueFormToken(SECRET, now);
    expect(verifyFormToken(token, SECRET, now + 1_500)).toBe(true);
  });

  it("rejects a token signed with a different secret (e.g. after pepper rotation)", () => {
    const now = 1_700_000_000_000;
    const token = issueFormToken(SECRET, now);
    expect(verifyFormToken(token, "a-completely-different-pepper-value", now + 2_000)).toBe(false);
  });

  it("rejects a MAC of a different length (truncated or extended) without throwing", () => {
    const now = 1_700_000_000_000;
    const token = issueFormToken(SECRET, now);
    const [ts, mac] = token.split(".");
    expect(verifyFormToken(`${ts}.${mac.slice(0, -1)}`, SECRET, now + 5_000)).toBe(false);
    expect(verifyFormToken(`${ts}.${mac}A`, SECRET, now + 5_000)).toBe(false);
    expect(verifyFormToken(`${ts}.${mac.slice(0, 10)}`, SECRET, now + 5_000)).toBe(false);
    expect(verifyFormToken(`${ts}.`, SECRET, now + 5_000)).toBe(false);
  });

  it("rejects malformed tokens", () => {
    const now = 1_700_000_000_000;
    expect(verifyFormToken("", SECRET, now)).toBe(false);
    expect(verifyFormToken("no-dot-here", SECRET, now)).toBe(false);
    expect(verifyFormToken("notanumber.abc123", SECRET, now)).toBe(false);
    expect(verifyFormToken("123..", SECRET, now)).toBe(false);
  });
});
