import type { RouterContextProvider } from "react-router";

import { config as appConfig } from "@server/config.ts";
import { db as appDb } from "@server/db/client.ts";
import { limiters, clientKey as computeClientKey } from "@server/modules/auth/rate-limit.ts";
import { assertSameOrigin } from "@server/modules/auth/csrf.ts";
import { logger } from "@server/logger.ts";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@server/modules/shared/errors.ts";
import { DomainError } from "@domain/errors.ts";

import { requestContext } from "~/context.ts";

export { appDb as getDbInstance };

/** Re-exports the shared drizzle db instance. */
export function getDb() {
  return appDb;
}

/** Re-exports the shared server config. */
export function getConfig() {
  return appConfig;
}

/**
 * Same-origin guard for every mutating (non-GET) route action. Throws a 403
 * Response when the request cannot be verified as same-origin (see
 * docs/architecture.md §4.4).
 */
export function mutationGuard(request: Request): void {
  assertSameOrigin(request, appConfig);
}

/** Serializable shape returned by actions on validation/domain failure. */
export interface ActionError {
  ok: false;
  code: string;
  field?: string;
  message: string;
  current?: unknown;
}

/**
 * Maps a thrown error from a domain/server call into a serializable
 * `ActionError`. The `code` is meant to be looked up client-side via
 * `t('validation.' + code)` with a fallback to `t('errors.generic')`;
 * `message` carries the server-side message only as a last-resort fallback
 * (e.g. for logging), never rendered directly to end users for unknown codes.
 */
export function toActionError(error: unknown, requestId?: string): ActionError {
  if (error instanceof ValidationError) {
    return { ok: false, code: error.code, field: error.field, message: error.message };
  }
  if (error instanceof ConflictError) {
    return { ok: false, code: "CONFLICT", message: error.message, current: error.current };
  }
  if (error instanceof NotFoundError) {
    return { ok: false, code: "NOT_FOUND", message: error.message };
  }
  if (error instanceof DomainError) {
    return { ok: false, code: error.code, message: error.message };
  }
  if (error instanceof AppError) {
    return { ok: false, code: "UNEXPECTED", message: error.message };
  }
  logger.error({ err: error, requestId }, "unexpected error in route action");
  return { ok: false, code: "UNEXPECTED", message: "Unexpected error" };
}

/**
 * Checks `limiterName` (from `server/modules/auth/rate-limit.ts` `limiters`)
 * for the caller's client key, and throws a 429 Response with a
 * `Retry-After` header (seconds) when denied. `context` is the route's
 * `RouterContextProvider` (from loader/action args) — used to read the real
 * client IP that `server/http/app.ts` wires into `requestContext`; pass an
 * explicit `key` instead when a different key is more appropriate (e.g. a
 * session public id for admin-elevation rate limiting).
 */
export function rateLimit(
  request: Request,
  limiterName: keyof typeof limiters,
  context?: RouterContextProvider,
  key?: string,
): string {
  const limiter = limiters[limiterName];
  const effectiveKey = key ?? computeClientKey({ ip: context?.get(requestContext)?.clientIp });
  const result = limiter.check(effectiveKey);
  if (!result.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    throw new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    });
  }
  return effectiveKey;
}

/** Adapts a web `Request` (plus the request context's client IP) to the shape `clientKey` expects. */
/**
 * Awaits until at least `floorMs` has elapsed since `startedAt` (a
 * `performance.now()`/`Date.now()` timestamp), so failure responses (e.g. a
 * wrong join phrase) take a fixed minimum time regardless of how fast the
 * underlying check failed — a defense against timing side-channels.
 */
export async function enforceResponseFloor(startedAt: number, floorMs = 250): Promise<void> {
  const elapsed = Date.now() - startedAt;
  const remaining = floorMs - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}
