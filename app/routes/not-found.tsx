/**
 * Catch-all for any path that matches nothing else (`route("*", ...)` in app/routes.ts).
 *
 * Without this, a truly unmatched path has no matched routes at all — not even "root" — so
 * React Router renders the root ErrorBoundary (app/root.tsx) without ever running the root
 * loader. That loader is what resolves the interface locale (from the `skyldig_lang` cookie /
 * `Accept-Language`) into `LocaleContext`, so the 404 page would always fall back to the
 * default Swedish regardless of the visitor's actual language. Matching this route instead
 * keeps "root" as an ancestor, so its loader runs normally and the 404 page renders in the
 * right language — the thrown 404 `Response` bubbles straight to root's existing
 * `isRouteErrorResponse(error) && error.status === 404` branch.
 */
export async function loader() {
  throw new Response("Not Found", { status: 404 });
}
