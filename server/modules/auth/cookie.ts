import type { Config } from "../../config.ts";

const MAX_AGE_SECONDS = 90 * 24 * 60 * 60; // 90 days

export function getCookieName(config: Pick<Config, "cookieSecure">): string {
  return config.cookieSecure ? "__Host-skyldig" : "skyldig";
}

export function buildSessionCookie(config: Pick<Config, "cookieSecure">, token: string): string {
  const name = getCookieName(config);
  const attrs = [
    `${name}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (config.cookieSecure) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildClearCookie(config: Pick<Config, "cookieSecure">): string {
  const name = getCookieName(config);
  const attrs = [`${name}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (config.cookieSecure) attrs.push("Secure");
  return attrs.join("; ");
}

/** Tiny cookie-header parser: no external dependency, just enough for our single cookie. */
export function readSessionToken(
  cookieHeader: string | null | undefined,
  config: Pick<Config, "cookieSecure">,
): string | null {
  if (!cookieHeader) return null;
  const name = getCookieName(config);
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}
