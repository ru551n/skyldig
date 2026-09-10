import { redirect } from "react-router";

import { requireSessionAccess } from "@server/modules/auth/session-auth.ts";

import { getConfig, getDb, mutationGuard } from "~/lib/session-context.server.ts";

import type { Route } from "./+types/create-ack";

/**
 * Resource route (no UI): backs the "I have saved the admin key" acknowledgement gate shown
 * right after group creation (`app/routes/new.tsx`). That gate is a plain `<form>` with a
 * `required`, deliberately unnamed checkbox, so the browser's own constraint validation
 * enforces it with JavaScript disabled — but a GET form always re-appends the query string on
 * submit, which would land the user on `/s/:sid?` (a trailing `?` on the URL they bookmark to
 * get back into their account-less group). Posting here instead and redirecting server-side
 * keeps that URL clean.
 *
 * Given its own path rather than posting straight to `/s/:sid` for the same reason
 * `bjud-in` (`invite-create.tsx`) has its own path: that URL is also matched by the dashboard
 * index route, and a submission routes to the leaf-most match.
 *
 * The redirect target is always `/s/<the :sid route param>` — never a value taken from the
 * request — so this cannot become an open redirect.
 */
export async function action({ request, params }: Route.ActionArgs) {
  mutationGuard(request);
  const db = getDb();
  const config = getConfig();
  await requireSessionAccess(db, request, config, params.sid!);

  return redirect(`/s/${params.sid}`, { headers: { "Cache-Control": "no-store" } });
}

/** No GET handler and no default export — this route is action-only. */
export function loader() {
  throw redirect("..");
}
