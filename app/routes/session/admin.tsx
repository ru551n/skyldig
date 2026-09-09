import { useEffect, useRef, useState } from "react";
import { data, Form, redirect, useNavigation, useSubmit } from "react-router";
import { z } from "zod";

import { grantAccess, rotateBrowserSession } from "@server/modules/auth/browser-session.ts";
import {
  ELEVATE_PER_SESSION_LOCK_MS,
  clientKey,
  limiters,
} from "@server/modules/auth/rate-limit.ts";
import {
  requireAdmin,
  requireSessionAccess,
  withSetCookie,
} from "@server/modules/auth/session-auth.ts";
import {
  deleteSession,
  rotateAccessPhrase,
  rotateAdminKey,
  verifyAdminKey,
} from "@server/modules/session/index.ts";

import { Button, ConfirmDialog, Dialog, Field, Input, PageHeader } from "~/components/ui/index.ts";
import { requestContext } from "~/context.ts";
import { formatExpiryLong } from "~/lib/format.ts";
import {
  enforceResponseFloor,
  getConfig,
  getDb,
  mutationGuard,
  toActionError,
  type ActionError,
} from "~/lib/session-context.server.ts";
import { toIntlLocale, useLocale, useT } from "~/i18n";

import type { Route } from "./+types/admin";

interface LoaderData {
  isAdmin: boolean;
  sessionName: string;
  expiresAt: string;
}

interface ElevateSuccess {
  ok: true;
  intent: "elevate";
}
interface RotatePhraseSuccess {
  ok: true;
  intent: "rotate-phrase";
  phrase: string;
}
interface RotateAdminKeySuccess {
  ok: true;
  intent: "rotate-admin-key";
  adminKey: string;
}
type ActionSuccess = ElevateSuccess | RotatePhraseSuccess | RotateAdminKeySuccess;
type ActionFailure = ActionError & { intent: string };
type ActionResult = ActionSuccess | ActionFailure;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/**
 * Without this, React Router discards every header the loader/action set on a document
 * response except `Set-Cookie` — this route's loader/action set `Cache-Control: no-store`
 * (private group/admin data) and, on a rate-limited elevation attempt, `Retry-After`; both
 * would silently disappear without this export.
 */
export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
  return [...actionHeaders.keys()].length > 0 ? actionHeaders : loaderHeaders;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid);

  return data<LoaderData>(
    {
      isAdmin: access.grant.role === "admin",
      sessionName: access.session.name,
      expiresAt: access.session.expiresAt.toISOString(),
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function action({ request, params, context }: Route.ActionArgs) {
  mutationGuard(request);
  const db = getDb();
  const config = getConfig();
  const formData = await request.formData();
  const intent = String(formData.get("_intent") ?? "");
  const headers = new Headers(NO_STORE_HEADERS);

  if (intent === "elevate") {
    const startedAt = Date.now();
    const access = await requireSessionAccess(db, request, config, params.sid);

    const clientIp = context.get(requestContext)?.clientIp;
    const key = clientKey({ ip: clientIp });

    const clientCheck = limiters.elevate.check(key);
    const sessionCheck = limiters.elevatePerSession.check(access.session.publicId);
    if (!clientCheck.allowed || !sessionCheck.allowed) {
      // Only arm the lock when this denial is itself caused by exceeding the hourly rule —
      // never when it's caused by an existing lock, or every member re-arms the 15-minute
      // lock forever and it never actually expires.
      if (!sessionCheck.allowed && sessionCheck.reason === "limit") {
        limiters.elevatePerSession.lock(access.session.publicId, ELEVATE_PER_SESSION_LOCK_MS);
      }
      const retryAfterMs = Math.max(clientCheck.retryAfterMs, sessionCheck.retryAfterMs);
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      await enforceResponseFloor(startedAt);
      return data<ActionResult>(
        { ok: false, code: "RATE_LIMITED", message: "", intent },
        {
          status: 429,
          headers: mergeHeaders(headers, new Headers({ "Retry-After": String(retryAfterSeconds) })),
        },
      );
    }

    const parsed = z
      .object({ adminKey: z.string().trim().min(1) })
      .safeParse({ adminKey: formData.get("adminKey") });
    if (!parsed.success) {
      await enforceResponseFloor(startedAt);
      return data<ActionResult>(
        { ok: false, code: "INVALID_KEY", field: "adminKey", message: "", intent },
        { status: 422, headers },
      );
    }

    try {
      const valid = await verifyAdminKey(db, config, access.session.id, parsed.data.adminKey);
      if (!valid) {
        await enforceResponseFloor(startedAt);
        return data<ActionResult>(
          { ok: false, code: "INVALID_KEY", field: "adminKey", message: "", intent },
          { status: 422, headers },
        );
      }

      await db.transaction(async (tx) => {
        await grantAccess(tx, access.browserSession.id, access.session.id, "admin");
        const rotated = await rotateBrowserSession(tx, access.browserSession.id);
        withSetCookie(headers, config, rotated.token);
      });

      await enforceResponseFloor(startedAt);
      return data<ActionResult>({ ok: true, intent }, { headers });
    } catch (error) {
      await enforceResponseFloor(startedAt);
      const actionError = toActionError(error);
      return data<ActionResult>({ ...actionError, intent }, { status: 500, headers });
    }
  }

  if (intent === "rotate-phrase") {
    try {
      const access = await requireAdmin(db, request, config, params.sid);
      const phrase = await db.transaction(async (tx) =>
        rotateAccessPhrase(tx, config, access.session.id, access.browserSession.id),
      );
      return data<ActionResult>({ ok: true, intent, phrase }, { headers });
    } catch (error) {
      const actionError = toActionError(error);
      return data<ActionResult>({ ...actionError, intent }, { status: 500, headers });
    }
  }

  if (intent === "rotate-admin-key") {
    try {
      const access = await requireAdmin(db, request, config, params.sid);
      const adminKey = await db.transaction(async (tx) =>
        rotateAdminKey(tx, config, access.session.id, access.browserSession.id),
      );
      return data<ActionResult>({ ok: true, intent, adminKey }, { headers });
    } catch (error) {
      const actionError = toActionError(error);
      return data<ActionResult>({ ...actionError, intent }, { status: 500, headers });
    }
  }

  if (intent === "delete-session") {
    const access = await requireAdmin(db, request, config, params.sid);
    const parsed = z
      .object({ confirmName: z.string() })
      .safeParse({ confirmName: formData.get("confirmName") });
    if (!parsed.success || parsed.data.confirmName !== access.session.name) {
      return data<ActionResult>(
        { ok: false, code: "NAME_MISMATCH", field: "confirmName", message: "", intent },
        { status: 422, headers },
      );
    }
    await db.transaction(async (tx) => {
      await deleteSession(tx, access.session.id);
    });
    return redirect("/", { headers });
  }

  throw new Response("Bad Request", { status: 400, headers });
}

function mergeHeaders(base: Headers, extra: Headers): Headers {
  const merged = new Headers(base);
  extra.forEach((value, key) => merged.set(key, value));
  return merged;
}

/** Looks up a `validation.<code>` message, falling back to the generic error copy. */
function errorMessage(t: ReturnType<typeof useT>, code: string): string {
  try {
    return (t as (key: string) => string)(`validation.${code}`);
  } catch {
    return t("errors.generic");
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(value);
      } else {
        const el = document.createElement("textarea");
        el.value = value;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access denied — the value is still selectable text.
    }
  }

  return (
    <Button type="button" variant="secondary" onClick={handleCopy}>
      {copied ? "Kopierad!" : "Kopiera"}
    </Button>
  );
}

export default function AdminPage({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const navigation = useNavigation();
  const submit = useSubmit();
  const pendingIntent =
    navigation.state !== "idle" && navigation.formData
      ? String(navigation.formData.get("_intent") ?? "")
      : undefined;

  const elevateError: ActionFailure | undefined =
    actionData && !actionData.ok && actionData.intent === "elevate" ? actionData : undefined;
  const deleteError: ActionFailure | undefined =
    actionData && !actionData.ok && actionData.intent === "delete-session" ? actionData : undefined;
  const phraseResult: RotatePhraseSuccess | undefined =
    actionData && actionData.ok && actionData.intent === "rotate-phrase" ? actionData : undefined;
  const adminKeyResult: RotateAdminKeySuccess | undefined =
    actionData && actionData.ok && actionData.intent === "rotate-admin-key"
      ? actionData
      : undefined;

  const secretHeadingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if ((phraseResult || adminKeyResult) && secretHeadingRef.current) {
      secretHeadingRef.current.focus();
    }
  }, [phraseResult, adminKeyResult]);

  const [rotatePhraseOpen, setRotatePhraseOpen] = useState(false);
  const [rotateAdminKeyOpen, setRotateAdminKeyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  if (!loaderData.isAdmin) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[65ch] flex-col gap-6 p-6 pb-16">
        <PageHeader title={t("admin.title")} lead={t("admin.elevateLead")} />

        {elevateError && (
          <p
            role="alert"
            className="rounded-control border-rust/40 bg-rust/5 text-body text-rust border p-3"
          >
            {elevateError.code === "RATE_LIMITED"
              ? t("admin.tooManyAttempts")
              : t("errors.keyMismatch")}
          </p>
        )}

        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="_intent" value="elevate" />
          <Field htmlFor="adminKey" label={t("admin.elevateLabel")}>
            {(ids) => (
              <Input
                {...ids}
                name="adminKey"
                type="text"
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="none"
                required
              />
            )}
          </Field>
          <Button type="submit" size="lg" loading={pendingIntent === "elevate"} fullWidth>
            {t("admin.unlock")}
          </Button>
        </Form>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[65ch] flex-col gap-6 p-6 pb-16">
      <PageHeader
        title={t("admin.title")}
        lead={t("admin.expiresLabel", { date: formatExpiryLong(loaderData.expiresAt, toIntlLocale(locale)) })}
      />

      <p role="status" aria-live="polite" className="text-meta text-moss font-medium">
        {t("admin.grantedNotice")}
      </p>

      {phraseResult && (
        <section className="rounded-card border-sol bg-sol/20 flex flex-col gap-2 border-2 p-5">
          <h2
            ref={secretHeadingRef}
            tabIndex={-1}
            className="text-lead text-pine font-semibold outline-none"
          >
            {t("admin.newPhraseTitle")}
          </h2>
          <p className="text-meta text-pine-soft">{t("admin.newPhraseNotice")}</p>
          <p className="tabular text-lead text-pine font-semibold break-words select-all">
            {phraseResult.phrase}
          </p>
          <div>
            <CopyButton value={phraseResult.phrase} />
          </div>
        </section>
      )}

      {adminKeyResult && (
        <section className="rounded-card border-rust bg-rust/5 flex flex-col gap-2 border-2 p-5">
          <h2
            ref={secretHeadingRef}
            tabIndex={-1}
            className="text-lead text-rust font-semibold outline-none"
          >
            {t("admin.newAdminKeyTitle")}
          </h2>
          <p className="text-meta text-rust">{t("admin.newAdminKeyNotice")}</p>
          <p className="tabular text-lead text-pine font-semibold break-words select-all">
            {adminKeyResult.adminKey}
          </p>
          <div>
            <CopyButton value={adminKeyResult.adminKey} />
          </div>
        </section>
      )}

      <section className="rounded-card border-line bg-paper flex flex-col gap-5 border p-5">
        <h2 className="text-lead text-pine font-semibold">{t("admin.actionsTitle")}</h2>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            loading={pendingIntent === "rotate-phrase"}
            onClick={() => setRotatePhraseOpen(true)}
          >
            {t("admin.rotatePhrase")}
          </Button>
          <p className="text-meta text-pine-soft">{t("admin.rotatePhraseBody")}</p>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            loading={pendingIntent === "rotate-admin-key"}
            onClick={() => setRotateAdminKeyOpen(true)}
          >
            {t("admin.rotateAdminKey")}
          </Button>
        </div>

        <div className="border-line flex flex-col gap-2 border-t pt-4">
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              setConfirmName("");
              setDeleteOpen(true);
            }}
          >
            {t("admin.deleteSession")}
          </Button>
          <p className="text-meta text-rust">{t("admin.deleteConfirmBody")}</p>
        </div>
      </section>

      <ConfirmDialog
        open={rotatePhraseOpen}
        onOpenChange={setRotatePhraseOpen}
        title={t("admin.rotatePhraseConfirmTitle")}
        body={t("admin.rotatePhraseConfirmBody")}
        confirmLabel={t("admin.rotatePhrase")}
        pending={pendingIntent === "rotate-phrase"}
        onConfirm={() => {
          const fd = new FormData();
          fd.set("_intent", "rotate-phrase");
          submit(fd, { method: "post" });
          setRotatePhraseOpen(false);
        }}
      />

      <ConfirmDialog
        open={rotateAdminKeyOpen}
        onOpenChange={setRotateAdminKeyOpen}
        title={t("admin.rotateAdminKeyConfirmTitle")}
        body={t("admin.rotateAdminKeyConfirmBody")}
        confirmLabel={t("admin.rotateAdminKey")}
        pending={pendingIntent === "rotate-admin-key"}
        onConfirm={() => {
          const fd = new FormData();
          fd.set("_intent", "rotate-admin-key");
          submit(fd, { method: "post" });
          setRotateAdminKeyOpen(false);
        }}
      />

      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("admin.deleteConfirmTitle")}
        description={t("admin.deleteConfirmBody")}
      >
        <div className="flex flex-col gap-4">
          <Field
            htmlFor="confirmName"
            label={t("admin.deleteTypeToConfirm", { name: loaderData.sessionName })}
          >
            {(ids) => (
              <Input
                {...ids}
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          {deleteError && (
            <p role="alert" className="text-meta text-rust font-medium">
              {deleteError.code === "NAME_MISMATCH"
                ? t("admin.deleteNameMismatch")
                : errorMessage(t, deleteError.code)}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={confirmName !== loaderData.sessionName}
              loading={pendingIntent === "delete-session"}
              onClick={() => {
                const fd = new FormData();
                fd.set("_intent", "delete-session");
                fd.set("confirmName", confirmName);
                submit(fd, { method: "post" });
              }}
            >
              {t("admin.deleteConfirmButton")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
