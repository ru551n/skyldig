import { and, eq, gt, sql } from "drizzle-orm";

import type { Config } from "../../config.ts";
import { sessions } from "../../db/schema.ts";
import { logger } from "../../logger.ts";
import {
  findBrowserSessionByToken,
  getGrant,
  type BrowserSessionRow,
  type DbOrTx,
  type GrantRow,
} from "./browser-session.ts";
import { buildClearCookie, buildSessionCookie, readSessionToken } from "./cookie.ts";

const authLogger = logger.child({ module: "auth" });

export interface ResolvedBrowserSession {
  browserSession: BrowserSessionRow;
  token: string;
}

export interface SessionAccess {
  session: typeof sessions.$inferSelect;
  browserSession: BrowserSessionRow;
  grant: GrantRow;
}

/** Resolves the caller's browser session from the request cookie, or null if absent/invalid. */
export async function resolveBrowserSession(
  db: DbOrTx,
  request: Request,
  config: Pick<Config, "cookieSecure">,
): Promise<ResolvedBrowserSession | null> {
  const token = readSessionToken(request.headers.get("cookie"), config);
  if (!token) return null;
  const browserSession = await findBrowserSessionByToken(db, token);
  if (!browserSession) return null;
  return { browserSession, token };
}

function notFound(): never {
  throw new Response("Not Found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Requires that the caller's browser session holds a grant on `sessionPublicId`, and that the
 * target Skyldig session has not expired. Deliberately returns 404 for every failure mode
 * (no cookie, unknown session, no grant, expired session) so a caller cannot distinguish
 * "session does not exist" from "you have no access to it".
 */
export async function requireSessionAccess(
  db: DbOrTx,
  request: Request,
  config: Pick<Config, "cookieSecure">,
  sessionPublicId: string,
): Promise<SessionAccess> {
  const resolved = await resolveBrowserSession(db, request, config);
  if (!resolved) notFound();

  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.publicId, sessionPublicId), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  if (!session) notFound();

  const grant = await getGrant(db, resolved.browserSession.id, session.id);
  if (!grant) notFound();

  return { session, browserSession: resolved.browserSession, grant };
}

/** Same as `requireSessionAccess`, but additionally requires an `admin` role grant (403). */
export async function requireAdmin(
  db: DbOrTx,
  request: Request,
  config: Pick<Config, "cookieSecure">,
  sessionPublicId: string,
): Promise<SessionAccess> {
  const access = await requireSessionAccess(db, request, config, sessionPublicId);
  if (access.grant.role !== "admin") {
    authLogger.info({ sessionPublicId }, "admin access denied: caller is not an admin");
    throw new Response("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return access;
}

/** Appends a Set-Cookie header carrying the browser session token onto `headers`. */
export function withSetCookie(headers: Headers, config: Pick<Config, "cookieSecure">, token: string): Headers {
  headers.append("Set-Cookie", buildSessionCookie(config, token));
  return headers;
}

/** Appends a Set-Cookie header that clears the browser session cookie onto `headers`. */
export function withClearCookie(headers: Headers, config: Pick<Config, "cookieSecure">): Headers {
  headers.append("Set-Cookie", buildClearCookie(config));
  return headers;
}
