import { data, redirect, useFetcher } from "react-router";
import { useEffect, useRef } from "react";

import {
  createBrowserSession,
  grantAccess,
  rotateBrowserSession,
} from "@server/modules/auth/browser-session.ts";
import { resolveBrowserSession, withSetCookie } from "@server/modules/auth/session-auth.ts";
import { limiters, clientKey, checkThenGlobal } from "@server/modules/auth/rate-limit.ts";
import { burnInvite, findRedeemableInvite } from "@server/modules/session/invite.ts";
import { sessions } from "@server/db/schema.ts";
import { eq } from "drizzle-orm";

import { ButtonLink } from "~/components/ui/index.ts";
import { requestContext } from "~/context.ts";
import { enforceResponseFloor, getConfig, getDb, mutationGuard } from "~/lib/session-context.server.ts";
import { useT } from "~/i18n";

import type { Route } from "./+types/invite";

interface RedeemFailure {
  ok: false;
  code: "INVALID_INVITE" | "RATE_LIMITED";
  retryAfterSeconds?: number;
}

interface RedeemSuccess {
  ok: true;
  sessionPublicId: string;
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Gå med i grupp — Skyldig" }];
}

/**
 * Without this, React Router discards every header the action set on a document response
 * except `Set-Cookie` — in particular the `Retry-After` header on a rate-limited (429)
 * response would silently disappear.
 */
export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
  return [...actionHeaders.keys()].length > 0 ? actionHeaders : loaderHeaders;
}

/**
 * Redeems an invite token. The token itself never reaches this action via the URL — it
 * travels only in the fragment, which the browser never sends to any server — the client
 * reads `location.hash` and posts the token in the request body instead. Reuses the join
 * rate limiters, since redeeming an invite is the same kind of credential-guessing surface
 * as guessing a phrase, just against a much smaller, short-lived keyspace.
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  mutationGuard(request);
  const startedAt = Date.now();
  const config = getConfig();
  const db = getDb();

  const clientIp = context.get(requestContext)?.clientIp;
  const key = clientKey({ ip: clientIp });

  const rateResult = checkThenGlobal(limiters.invite, limiters.inviteGlobal, key);
  if (!rateResult.allowed) {
    const retryAfterMs = rateResult.retryAfterMs;
    await enforceResponseFloor(startedAt);
    return data<RedeemFailure>(
      {
        ok: false,
        code: "RATE_LIMITED",
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) },
      },
    );
  }

  const formData = await request.formData();
  const token = String(formData.get("token") ?? "");
  const invitePublicId = params.iid!;

  const invite = token ? await findRedeemableInvite(db, invitePublicId, token) : null;
  if (!invite) {
    await enforceResponseFloor(startedAt);
    return data<RedeemFailure>({ ok: false, code: "INVALID_INVITE" }, { status: 422 });
  }

  // The invite row carries the group's internal id, not its public id — look the public
  // id up before the transaction burns the invite, so the redirect target is known.
  const [targetSession] = await db
    .select({ publicId: sessions.publicId })
    .from(sessions)
    .where(eq(sessions.id, invite.sessionId))
    .limit(1);
  if (!targetSession) {
    await enforceResponseFloor(startedAt);
    return data<RedeemFailure>({ ok: false, code: "INVALID_INVITE" }, { status: 422 });
  }

  const headers = new Headers();
  let redeemed = false;
  await db.transaction(async (tx) => {
    const existing = await resolveBrowserSession(tx, request, config);
    let browserSessionId: bigint;
    let token2: string;
    if (existing) {
      const rotated = await rotateBrowserSession(tx, existing.browserSession.id);
      browserSessionId = rotated.id;
      token2 = rotated.token;
    } else {
      const created = await createBrowserSession(tx);
      browserSessionId = created.id;
      token2 = created.token;
    }

    // Burn the invite inside the same transaction that grants access, so two concurrent
    // redemptions of the same single-use invite cannot both succeed: the second `burnInvite`
    // call finds the row already marked used and returns false.
    redeemed = await burnInvite(tx, invite.id, browserSessionId);
    if (!redeemed) return;

    await grantAccess(tx, browserSessionId, invite.sessionId, invite.role);
    withSetCookie(headers, config, token2);
  });

  await enforceResponseFloor(startedAt);
  if (!redeemed) {
    return data<RedeemFailure>({ ok: false, code: "INVALID_INVITE" }, { status: 422 });
  }
  return redirect(`/s/${targetSession.publicId}`, { headers });
}

export default function InvitePage({ actionData }: Route.ComponentProps) {
  const t = useT();
  const fetcher = useFetcher<RedeemSuccess | RedeemFailure>();
  const submittedRef = useRef(false);

  useEffect(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const token = window.location.hash.slice(1);
    // Clear the token from the visible URL immediately — it must not linger in browser
    // history, and this also prevents a page refresh from re-submitting it.
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) return;
    fetcher.submit({ token }, { method: "post" });
  }, [fetcher]);

  const result = fetcher.data ?? actionData;
  const failed = result && !result.ok;

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-[65ch] flex-col items-start justify-center gap-4 p-6"
    >
      <noscript>
        <p className="text-body text-pine-soft">{t("invite.needsJavascript")}</p>
        <ButtonLink to="/join">{t("invite.joinWithPhrase")}</ButtonLink>
      </noscript>

      {!failed ? (
        <>
          <h1 className="text-h1 text-pine font-semibold">{t("invite.redeemTitle")}</h1>
          <p className="text-body text-pine-soft" aria-live="polite">
            {t("invite.redeemBody")}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-h1 text-pine font-semibold">{t("invite.invalidTitle")}</h1>
          <p className="text-body text-pine-soft">{t("invite.invalidBody")}</p>
          <ButtonLink to="/join">{t("invite.joinWithPhrase")}</ButtonLink>
        </>
      )}
    </main>
  );
}
