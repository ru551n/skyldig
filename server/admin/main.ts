/**
 * Entry point of the operator admin app (`node build/admin/main.js`). See server/admin/app.ts and
 * the README's "Admin app" section for how it is deployed behind Caddy and Authentik.
 */
import pg from "pg";
import pino from "pino";

import { createAdminApp } from "./app.ts";
import { loadAdminConfig } from "./config.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", base: { service: "skyldig-admin" } });

const config = loadAdminConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
pool.on("error", (err) => logger.error({ err }, "idle database client error"));

const app = createAdminApp({ pool, config, onError: (err) => logger.error({ err }, "request failed") });
app.listen(config.port, () => {
  logger.info({ port: config.port, trustedProxies: config.trustedProxies, publicOrigin: config.publicOrigin }, "admin app listening");
});
