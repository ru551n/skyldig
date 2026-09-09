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
import { sanitizeRequestId } from "./request-id.ts";
import { resolveLocale } from "../modules/i18n/locale-cookie.ts";

export const app = express();

startCleanupScheduler(db);

logger.info(
  {
    nodeEnv: config.nodeEnv,
    port: config.port,
    publicOrigin: config.publicOrigin,
    cookieSecure: config.cookieSecure,
    trustProxy: config.trustProxy,
    phraseEntropyBits: phraseEntropyBits(),
  },
  "skyldig server starting",
);

app.disable("x-powered-by");
// `req.ip` (the only client identity the rate limiters use, see `clientKey`) is resolved by
// Express from this setting — hop count or trusted-peer list, never "trust everything".
if (config.trustProxy !== false) {
  app.set("trust proxy", config.trustProxy);
}

app.use(assignCspNonce);
app.use(buildSecurityMiddleware(config));

// Every request that reaches this app has already had its chance to be served by
// `express.static` in server.js (mounted before this app there) — see server.js: static
// assets under /assets and build/client are served and short-circuited before `ssrApp`
// (this app) is ever invoked, so nothing here ever overrides their long-lived cache headers.
// This is the single choke point for every document response (loaders/actions on every
// React Router route, /health, /ready): default every response to `no-store` so authenticated
// HTML is never heuristically cacheable by a browser or a shared cache/CDN in front of a
// self-hosted deployment, and add `Vary: Cookie` since the response depends on the session
// cookie. A route can still opt into a different `Cache-Control` (none currently do) — this
// only fills in the header if nothing has set it by the time headers are flushed, and merges
// into an existing `Vary` rather than overwriting it.
app.use((_req, res, next) => {
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
    if (!res.getHeader("Cache-Control")) {
      res.setHeader("Cache-Control", "no-store, private");
    }
    const existingVary = res.getHeader("Vary");
    const varyValues = existingVary
      ? String(Array.isArray(existingVary) ? existingVary.join(",") : existingVary)
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      : [];
    if (!varyValues.some((v) => v.toLowerCase() === "cookie")) {
      varyValues.push("Cookie");
    }
    res.setHeader("Vary", varyValues.join(", "));
    return originalWriteHead(...args);
  }) as typeof res.writeHead;
  next();
});

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
      // Only honour a client-supplied X-Request-Id when we trust the upstream proxy to have
      // set (or scrubbed) it, and even then cap its shape — otherwise any client can forge a
      // value that gets echoed straight into our logs and response, enabling log-correlation
      // forgery (e.g. injecting another real request's id, or unbounded/control-character
      // junk into structured logs).
      const existing = config.trustProxy ? sanitizeRequestId(req.headers["x-request-id"]) : null;
      const id = existing ?? randomUUID();
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
        locale: resolveLocale(req.headers.cookie, req.headers["accept-language"]),
      });
      return context;
    },
  }),
);
