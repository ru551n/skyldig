import pino from "pino";

import { config } from "./config.ts";

/**
 * Redaction paths for secret-shaped fields, covering a field at the top level, one level
 * nested, and two levels nested (e.g. `{phrase}`, `{a:{phrase}}`, `{a:{b:{phrase}}}`) — pino's
 * `*` wildcard matches exactly one path segment, so each depth needs its own explicit pattern.
 * Log call sites nest secrets no deeper than this in practice (e.g. `{ session: { phrase } }`).
 */
const SECRET_KEYS = ["phrase", "adminKey", "token", "accessKey", "password"];
export const redactPaths = [
  "req.headers.cookie",
  "req.headers.authorization",
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((key) => `*.${key}`),
  ...SECRET_KEYS.map((key) => `*.*.${key}`),
];
export const redactCensor = "[redacted]";

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: redactPaths,
    censor: redactCensor,
  },
  transport: config.isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
});
