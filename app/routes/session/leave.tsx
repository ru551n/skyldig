import { redirect } from "react-router";

import {
  deleteBrowserSessionIfEmpty,
  revokeGrant,
  rotateBrowserSession,
} from "@server/modules/auth/browser-session.ts";
import {
  requireSessionAccess,
  withClearCookie,
  withSetCookie,
} from "@server/modules/auth/session-auth.ts";

import { getConfig, getDb, mutationGuard } from "~/lib/session-context.server.ts";

import type { Route } from "./+types/leave";

/**
 * Leaves the group: revokes this browser's grant, rotates the browser session token
 * (per docs/architecture.md §4.3 — token rotation on any grant change), and clears
 * the cookie entirely if no grants remain anywhere. Redirects to `/?lamnad=1` so the
 * landing page can show a toast; no UI of its own — the confirm dialog lives in the
 * session layout and posts here.
 */
export async function action({ request, params }: Route.ActionArgs) {
  mutationGuard(request);
  const config = getConfig();
  const db = getDb();
  const access = await requireSessionAccess(db, request, config, params.sid!);

  const headers = new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });

  await db.transaction(async (tx) => {
    await revokeGrant(tx, access.browserSession.id, access.session.id);
    const rotated = await rotateBrowserSession(tx, access.browserSession.id);
    const deleted = await deleteBrowserSessionIfEmpty(tx, rotated.id);
    if (deleted) {
      withClearCookie(headers, config);
      // Tell the browser to actually drop the cookie jar (and any cached/scripted state) for
      // this origin now that the browser session is gone entirely — belt-and-braces alongside
      // the Set-Cookie clear above. Only when the cookie is actually being cleared: if the
      // browser still holds grants elsewhere, its (rotated) cookie must survive.
      headers.set("Clear-Site-Data", '"cookies"');
    } else {
      withSetCookie(headers, config, rotated.token);
    }
  });

  return redirect("/?lamnad=1", { headers });
}

export default function Leave() {
  return null;
}
