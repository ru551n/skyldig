import { data, redirect } from "react-router";

import { requireSessionAccess, resolveBrowserSession } from "@server/modules/auth/session-auth.ts";
import { limiters, clientKey, checkThenGlobal } from "@server/modules/auth/rate-limit.ts";
import { createInvite, INVITE_TTL_MS } from "@server/modules/session/invite.ts";

import { requestContext } from "~/context.ts";
import { getConfig, getDb, mutationGuard } from "~/lib/session-context.server.ts";

import type { Route } from "./+types/invite-create";

interface InviteCreateSuccess {
  ok: true;
  url: string;
  expiresAt: string;
  ttlMs: number;
}

interface InviteCreateFailure {
  ok: false;
  code: "RATE_LIMITED";
  retryAfterSeconds: number;
}

/**
 * Without this, React Router discards every header the action set on a document response
 * except `Set-Cookie` — in particular the `Retry-After` header on a rate-limited (429)
 * response would silently disappear. (This route is normally hit via `fetcher.submit`, not a
 * document navigation, but React Router still applies the same header-merging rule.)
 */
export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
  return [...actionHeaders.keys()].length > 0 ? actionHeaders : loaderHeaders;
}

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
 *
 * Rate-limited with the same `invite`/`inviteGlobal` limiters invite REDEMPTION already uses
 * (`app/routes/invite.tsx`) — they were sized for exactly this abuse surface (creating rows),
 * but creation itself went unchecked until this fix: any authenticated member could otherwise
 * insert unbounded `session_invites` rows between cleanup runs. Checked before doing any work,
 * per-client first so a flood from one member never drains the shared global budget (see
 * `checkThenGlobal`'s doc comment).
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  mutationGuard(request);
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid!);
  const resolved = await resolveBrowserSession(db, request, config);
  if (!resolved) throw new Response("Not Found", { status: 404 });

  const clientIp = context.get(requestContext)?.clientIp;
  const key = clientKey({ ip: clientIp, headers: headersOf(request) }, config);
  const rateResult = checkThenGlobal(limiters.invite, limiters.inviteGlobal, key);
  if (!rateResult.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(rateResult.retryAfterMs / 1000));
    return data<InviteCreateFailure>(
      { ok: false, code: "RATE_LIMITED", retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const created = await db.transaction((tx) =>
    createInvite(tx, access.session.id, resolved.browserSession.id, "member"),
  );

  const url = `${config.publicOrigin}/i/${created.publicId}#${created.token}`;
  return data<InviteCreateSuccess>({
    ok: true,
    url,
    expiresAt: created.invite.expiresAt.toISOString(),
    ttlMs: INVITE_TTL_MS,
  });
}

function headersOf(request: Request): Record<string, string> {
  const result: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/** No GET handler and no default export — this route is action-only. */
export function loader() {
  throw redirect("..");
}
