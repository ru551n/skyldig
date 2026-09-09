import type { Config } from "../../config.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Same-origin check for every non-GET/HEAD/OPTIONS request, per docs/architecture.md 4.4.
 * Throws a 403 Response (React Router convention: `throw`n Responses become the route error)
 * when the request cannot be verified as same-origin.
 */
export function assertSameOrigin(request: Request, config: Pick<Config, "publicOrigin">): void {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return;

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null) {
    if (secFetchSite !== "same-origin") {
      throw new Response("Forbidden", { status: 403 });
    }
    return;
  }

  const origin = request.headers.get("origin");
  if (origin === null || origin !== config.publicOrigin) {
    throw new Response("Forbidden", { status: 403 });
  }
}
