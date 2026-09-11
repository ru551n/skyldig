import { isIP } from "node:net";

import { z } from "zod";

const schema = z.object({
  ADMIN_DATABASE_URL: z.string().min(1, "ADMIN_DATABASE_URL is required"),
  ADMIN_PUBLIC_ORIGIN: z.string().url("ADMIN_PUBLIC_ORIGIN must be a URL, e.g. https://admin.example.com"),
  ADMIN_TRUSTED_PROXY: z.string().min(1, "ADMIN_TRUSTED_PROXY must list the reverse proxy's IP address(es)"),
  ADMIN_REQUIRED_GROUP: z.string().min(1).default("skyldig-admins"),
  APP_INTERNAL_URL: z.string().url().optional(),
  ADMIN_TIMEZONE: z.string().default("Europe/Stockholm"),
  PORT: z.coerce.number().int().positive().default(3001),
});

export interface AdminConfig {
  databaseUrl: string;
  /** Origin of the admin site as browsers see it; forms must come from exactly here. */
  publicOrigin: string;
  /** IP addresses of the reverse proxy; the only peers whose Authentik headers are believed. */
  trustedProxies: string[];
  requiredGroup: string;
  /** The main app on the internal network, for its /ready status. */
  appInternalUrl?: string;
  timeZone: string;
  port: number;
}

export function loadAdminConfig(env: NodeJS.ProcessEnv = process.env): AdminConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(
      `Invalid admin configuration:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  const trustedProxies = parsed.data.ADMIN_TRUSTED_PROXY.split(",").map((ip) => ip.trim()).filter(Boolean);
  const invalid = trustedProxies.filter((ip) => !isIP(ip));
  if (invalid.length > 0) {
    throw new Error(`ADMIN_TRUSTED_PROXY must be IP addresses (no names or ranges): ${invalid.join(", ")}`);
  }
  return {
    databaseUrl: parsed.data.ADMIN_DATABASE_URL,
    publicOrigin: new URL(parsed.data.ADMIN_PUBLIC_ORIGIN).origin,
    trustedProxies,
    requiredGroup: parsed.data.ADMIN_REQUIRED_GROUP,
    appInternalUrl: parsed.data.APP_INTERNAL_URL,
    timeZone: parsed.data.ADMIN_TIMEZONE,
    port: parsed.data.PORT,
  };
}
