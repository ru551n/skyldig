import { randomUUID } from "node:crypto";

import { createRequestHandler } from "@react-router/express";
import express from "express";
import pinoHttp from "pino-http";
import { RouterContextProvider } from "react-router";

import { requestContext } from "~/context.ts";

import { config } from "../config.ts";
import { db, pool } from "../db/client.ts";
import { logger } from "../logger.ts";
import { startCleanupScheduler } from "../modules/expiration/cleanup.ts";
import { phraseEntropyBits } from "../modules/session/phrase.ts";
import { assignCspNonce, buildSecurityMiddleware } from "./security.ts";

export const app = express();

startCleanupScheduler(db);

logger.info(
  {
    nodeEnv: config.nodeEnv,
    port: config.port,
    publicOrigin: config.publicOrigin,
    cookieSecure: config.cookieSecure,
    trustProxy: Boolean(config.trustProxy),
    phraseEntropyBits: phraseEntropyBits(),
  },
  "skyldig server starting",
);

app.disable("x-powered-by");
if (config.trustProxy) {
  app.set("trust proxy", config.trustProxy);
}

app.use(assignCspNonce);
app.use(buildSecurityMiddleware(config));

// Deliberately no express.json()/express.urlencoded() here: they would consume the request
// body stream before @react-router/express's createRequestHandler builds the web Request that
// route actions read via `request.formData()`. No server code reads `req.body`.
// The 64 kB limit from the architecture is enforced below without draining the stream.
const MAX_BODY_BYTES = 64 * 1024;

app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    res.status(413).type("text/plain").send("Payload Too Large");
    return;
  }
  // Guard against a missing or lying Content-Length (chunked uploads).
  let seen = 0;
  const onData = (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > MAX_BODY_BYTES) {
      req.off("data", onData);
      req.destroy();
      if (!res.headersSent) {
        res.status(413).type("text/plain").send("Payload Too Large");
      }
    }
  };
  req.on("data", onData);
  req.once("end", () => req.off("data", onData));
  next();
});

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
    getLoadContext(req, res) {
      const context = new RouterContextProvider();
      context.set(requestContext, {
        requestId: (req as unknown as { id?: string }).id ?? randomUUID(),
        logger,
        clientIp: req.ip,
        cspNonce: (res.locals.cspNonce as string | undefined) ?? "",
      });
      return context;
    },
  }),
);
