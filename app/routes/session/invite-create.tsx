import { redirect } from "react-router";

import { requireSessionAccess, resolveBrowserSession } from "@server/modules/auth/session-auth.ts";
import { createInvite, INVITE_TTL_MS } from "@server/modules/session/invite.ts";

import { getConfig, getDb, mutationGuard } from "~/lib/session-context.server.ts";

import type { Route } from "./+types/invite-create";

/**
 * Resource route (no UI): creates a single-use invite for the group and returns its
 * shareable URL. Given its own path rather than living on the layout route at `/s/:sid`,
 * because that URL is also matched by the dashboard index route, and React Router routes a
 * fetcher submission to the leaf-most match — an action on the layout would never run for a
 * submission to that shared path.
 *
 * The invite token travels only in the URL fragment, never sent to the server or logged —
 * see docs/architecture.md §4 and docs/todo.md "Share a group by QR code or link". Any
 * member may invite others; it grants the same 'member' role a phrase join would.
 */
export async function action({ request, params }: Route.ActionArgs) {
  mutationGuard(request);
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid!);
  const resolved = await resolveBrowserSession(db, request, config);
  if (!resolved) throw new Response("Not Found", { status: 404 });

  const created = await db.transaction((tx) =>
    createInvite(tx, access.session.id, resolved.browserSession.id, "member"),
  );

  const url = `${config.publicOrigin}/i/${created.publicId}#${created.token}`;
  return {
    ok: true as const,
    url,
    expiresAt: created.invite.expiresAt.toISOString(),
    ttlMs: INVITE_TTL_MS,
  };
}

/** No GET handler and no default export — this route is action-only. */
export function loader() {
  throw redirect("..");
}
