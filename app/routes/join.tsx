import { data, Form, redirect, useNavigation } from "react-router";

import {
  createBrowserSession,
  grantAccess,
  rotateBrowserSession,
} from "@server/modules/auth/browser-session.ts";
import { resolveBrowserSession, withSetCookie } from "@server/modules/auth/session-auth.ts";
import { limiters, clientKey, checkThenGlobal } from "@server/modules/auth/rate-limit.ts";
import { joinSession } from "@server/modules/session/index.ts";

import { Button, Field, Input, PageHeader } from "~/components/ui/index.ts";
import { requestContext } from "~/context.ts";
import {
  enforceResponseFloor,
  getConfig,
  getDb,
  mutationGuard,
} from "~/lib/session-context.server.ts";
import { useT } from "~/i18n";

import type { Route } from "./+types/join";

interface JoinFailure {
  ok: false;
  code: "INVALID_KEY" | "RATE_LIMITED";
  retryAfterSeconds?: number;
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

export async function action({ request, context }: Route.ActionArgs) {
  mutationGuard(request);
  const startedAt = Date.now();
  const config = getConfig();
  const db = getDb();

  const clientIp = context.get(requestContext)?.clientIp;
  const key = clientKey({ ip: clientIp });

  const rateResult = checkThenGlobal(limiters.join, limiters.joinGlobal, key);
  if (!rateResult.allowed) {
    const retryAfterMs = rateResult.retryAfterMs;
    await enforceResponseFloor(startedAt);
    return data<JoinFailure>(
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
  const phraseInput = String(formData.get("phrase") ?? "");

  const joinResult = await joinSession(db, config, phraseInput);
  limiters.join.recordFailure(key);
  limiters.joinGlobal.recordFailure("global");

  if (!joinResult) {
    await enforceResponseFloor(startedAt);
    return data<JoinFailure>({ ok: false, code: "INVALID_KEY" }, { status: 422 });
  }

  const headers = new Headers();
  await db.transaction(async (tx) => {
    const existing = await resolveBrowserSession(tx, request, config);
    let browserSessionId: bigint;
    let token: string;
    if (existing) {
      const rotated = await rotateBrowserSession(tx, existing.browserSession.id);
      browserSessionId = rotated.id;
      token = rotated.token;
    } else {
      const created = await createBrowserSession(tx);
      browserSessionId = created.id;
      token = created.token;
    }
    await grantAccess(tx, browserSessionId, joinResult.sessionId, "member");
    withSetCookie(headers, config, token);
  });

  await enforceResponseFloor(startedAt);
  return redirect(`/s/${joinResult.publicId}`, { headers });
}

export default function JoinSessionPage({ actionData }: Route.ComponentProps) {
  const t = useT();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  const error = actionData;
  const errorMessage =
    error?.code === "RATE_LIMITED"
      ? "För många försök. Vänta en stund och försök igen."
      : error?.code === "INVALID_KEY"
        ? t("errors.keyMismatch")
        : undefined;

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-[65ch] flex-col gap-6 p-6 pb-16"
    >
      <PageHeader title={t("join.title")} lead={t("join.lead")} />
      <p className="text-meta text-pine-soft -mt-4">{t("join.phraseLanguageNote")}</p>

      {errorMessage && (
        <p
          role="alert"
          className="rounded-control border-rust/40 bg-rust/5 text-body text-rust border p-3"
        >
          {errorMessage}
        </p>
      )}

      <Form method="post" className="flex flex-col gap-6">
        <Field
          htmlFor="phrase"
          label={t("join.phraseLabel")}
          hint={t("join.phraseHint")}
        >
          {(ids) => (
            <Input
              {...ids}
              name="phrase"
              type="text"
              inputMode="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              placeholder="ord-ord-ord-ord"
              required
              className="text-lead min-h-14"
            />
          )}
        </Field>

        <Button type="submit" size="lg" loading={submitting} fullWidth>
          {t("join.submit")}
        </Button>
      </Form>
    </main>
  );
}
