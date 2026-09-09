import { randomUUID } from "node:crypto";

import { createRequestHandler } from "@react-router/express";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { RouterContextProvider } from "react-router";

import { requestContext } from "~/context.ts";

import { config } from "../config.ts";
import { pool } from "../db/client.ts";
import { logger } from "../logger.ts";

export const app = express();

app.disable("x-powered-by");
if (config.trustProxy) {
  app.set("trust proxy", config.trustProxy);
}

app.use(
  helmet({
    // TODO(phase 7+): enable a CSP with a per-request nonce once inline scripts/styles are audited.
    contentSecurityPolicy: false,
  }),
);

app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const existing = req.headers["x-request-id"];
      const id = typeof existing === "string" ? existing : randomUUID();
      res.setHeader("x-request-id", id);
      return id;
    },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/ready", async (_req, res) => {
  try {
    await pool.query("select 1");
    res.json({ status: "ok" });
  } catch (error) {
    logger.error({ err: error }, "readiness check failed");
    res.status(503).json({ status: "unavailable" });
  }
});

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
    getLoadContext(req) {
      const context = new RouterContextProvider();
      context.set(requestContext, {
        requestId: (req as unknown as { id?: string }).id ?? randomUUID(),
        logger,
      });
      return context;
    },
  }),
);
