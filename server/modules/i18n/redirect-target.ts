import type { Config } from "../../config.ts";

/**
 * Resolves the safe redirect target for `app/routes/set-locale.tsx`'s `redirectTo` form
 * field. A naive `startsWith("/") && !startsWith("//")` check (the previous implementation)
 * does not actually constrain the target: browsers normalize backslashes to forward slashes
 * and some percent-encoded variants before resolving a URL, so e.g. `/\evil.example/p` can
 * still resolve off-origin even though the raw string "starts with a single slash". Parsing
 * with the WHATWG `URL` (which performs that same normalization) and comparing the resulting
 * `.origin` against the app's own origin — the same equivalence `assertSameOrigin`
 * (`server/modules/auth/csrf.ts`) uses for the `Origin` header — is authoritative rather than
 * a guess at what a browser might do with the raw string.
 *
 * An absolute same-origin URL (e.g. `https://app.example/foo`, when that *is* our own origin)
 * is accepted too, on the same reasoning `assertSameOrigin` uses: same-origin is same-origin
 * regardless of whether the caller wrote it as a path or a full URL. It is normalized down to
 * just its path + search + hash before being used as the redirect target, so the response
 * `Location` header never carries a scheme/host even when one was submitted.
 *
 * Kept in its own module (importing `Config` only as a type, never the runtime `config`
 * singleton) so it can be unit-tested without pulling in `server/config.ts`'s environment
 * parsing — mirroring how `server/modules/auth/csrf.ts` is structured.
 */
export function resolveRedirectTarget(redirectTo: unknown, config: Pick<Config, "publicOrigin">): string {
  if (typeof redirectTo !== "string" || redirectTo.length === 0) return "/";
  let url: URL;
  try {
    url = new URL(redirectTo, config.publicOrigin);
  } catch {
    return "/";
  }
  const expectedOrigin = new URL(config.publicOrigin).origin;
  if (url.origin !== expectedOrigin) return "/";
  return `${url.pathname}${url.search}${url.hash}` || "/";
}
