import { z } from "zod";

const DEV_PEPPER =
  "dev-only-pepper-not-for-production-use-please-change-me-1234";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  ACCESS_KEY_PEPPER: z.string().optional(),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:3000"),
  TRUST_PROXY: z.string().optional(),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

function parseEnv(env: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

const parsed = parseEnv(process.env);

const isProduction = parsed.NODE_ENV === "production";

let accessKeyPepper = parsed.ACCESS_KEY_PEPPER;
if (!accessKeyPepper) {
  if (isProduction) {
    throw new Error(
      "Invalid environment configuration:\n  - ACCESS_KEY_PEPPER: required in production (min 32 chars)",
    );
  }
  console.warn(
    "[config] ACCESS_KEY_PEPPER not set; using a fixed dev-only value. Never use this in production.",
  );
  accessKeyPepper = DEV_PEPPER;
}
if (isProduction && accessKeyPepper.length < 32) {
  throw new Error(
    "Invalid environment configuration:\n  - ACCESS_KEY_PEPPER: must be at least 32 characters in production",
  );
}

export const config = {
  nodeEnv: parsed.NODE_ENV,
  isProduction,
  port: parsed.PORT,
  databaseUrl: parsed.DATABASE_URL,
  accessKeyPepper,
  publicOrigin: parsed.PUBLIC_ORIGIN,
  trustProxy: parsed.TRUST_PROXY,
  cookieSecure: parsed.COOKIE_SECURE ?? isProduction,
  logLevel: parsed.LOG_LEVEL,
} as const;

export type Config = typeof config;
