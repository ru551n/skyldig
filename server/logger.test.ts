import { Writable } from "node:stream";

import pino from "pino";
import { describe, expect, it } from "vitest";

import { redactCensor, redactPaths } from "./logger.ts";

/** Builds a pino logger using the app's real redact config, capturing each log line. */
function buildTestLogger() {
  const lines: unknown[] = [];
  const stream = new Writable({
    write(chunk, _enc, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });
  const logger = pino({ redact: { paths: redactPaths, censor: redactCensor } }, stream);
  return { logger, lines };
}

describe("logger redaction", () => {
  it("redacts a top-level secret field", () => {
    const { logger, lines } = buildTestLogger();
    logger.info({ phrase: "correct-horse-battery-staple", other: "kept" });
    expect(lines[0]).toMatchObject({ phrase: redactCensor, other: "kept" });
  });

  it("redacts a one-level-nested secret field", () => {
    const { logger, lines } = buildTestLogger();
    logger.info({ session: { adminKey: "admin-secret", name: "kept" } });
    expect(lines[0]).toMatchObject({ session: { adminKey: redactCensor, name: "kept" } });
  });

  it("redacts a two-level-nested secret field", () => {
    const { logger, lines } = buildTestLogger();
    logger.info({ a: { b: { token: "super-secret-token", name: "kept" } } });
    expect(lines[0]).toMatchObject({ a: { b: { token: redactCensor, name: "kept" } } });
  });

  it("leaves unrelated fields untouched", () => {
    const { logger, lines } = buildTestLogger();
    logger.info({ requestId: "abc-123", nested: { count: 5 } });
    expect(lines[0]).toMatchObject({ requestId: "abc-123", nested: { count: 5 } });
  });

  it("still redacts request cookie/authorization headers", () => {
    const { logger, lines } = buildTestLogger();
    logger.info({ req: { headers: { cookie: "s=1", authorization: "Bearer x", host: "kept" } } });
    expect(lines[0]).toMatchObject({
      req: { headers: { cookie: redactCensor, authorization: redactCensor, host: "kept" } },
    });
  });
});
