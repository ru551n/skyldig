import pino from "pino";

import { config } from "./config.ts";

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "*.phrase",
      "*.adminKey",
      "*.token",
      "*.accessKey",
      "*.password",
    ],
    censor: "[redacted]",
  },
  transport: config.isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      },
});
