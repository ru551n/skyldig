/** A safe, boundedly-sized request id: at most 64 chars of `[A-Za-z0-9._-]`. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Validates a client-supplied `X-Request-Id` header value, returning `null` if unsafe. */
export function sanitizeRequestId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return REQUEST_ID_PATTERN.test(raw) ? raw : null;
}
