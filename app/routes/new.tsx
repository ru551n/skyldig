import { useState } from "react";
import { data, Form, useNavigation } from "react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { sessions } from "@server/db/schema.ts";
import { createBrowserSession, grantAccess } from "@server/modules/auth/browser-session.ts";
import { withSetCookie } from "@server/modules/auth/session-auth.ts";
import { limiters, clientKey, checkThenGlobal } from "@server/modules/auth/rate-limit.ts";
import { issueFormToken, verifyFormToken } from "@server/modules/auth/form-token.ts";
import { createSession } from "@server/modules/session/index.ts";
import { listCurrencies } from "@domain/currency/registry.ts";

import { Button, Field, Input, PageHeader, Select } from "~/components/ui/index.ts";
import { formatExpiryLong } from "~/lib/format.ts";
import { requestContext } from "~/context.ts";
import {
  getConfig,
  getDb,
  mutationGuard,
  toActionError,
  type ActionError,
} from "~/lib/session-context.server.ts";
import { toIntlLocale, useLocale, useT } from "~/i18n";

import type { Route } from "./+types/new";

const formSchema = z.object({
  name: z.string().trim().min(1).max(80),
  baseCurrency: z.string().trim().min(1),
  participant: z.union([z.string(), z.array(z.string())]).optional(),
});

interface CreateSuccess {
  ok: true;
  name: string;
  publicId: string;
  phrase: string;
  adminKey: string;
  expiresAt: string;
}

type ActionResult =
  CreateSuccess | (ActionError & { name?: string; baseCurrency?: string; participants?: string[] });

export function loader(_args: Route.LoaderArgs) {
  const config = getConfig();
  return { currencies: listCurrencies(), formToken: issueFormToken(config.accessKeyPepper) };
}

/**
 * Without this, React Router discards every header the loader/action set on a document
 * response except `Set-Cookie` (see docs on `HeadersFunction`) — this route's action sets
 * `Cache-Control: no-store` on a response whose body is the plaintext access phrase and admin
 * key, so that must survive.
 */
export function headers({ actionHeaders, loaderHeaders }: Route.HeadersArgs) {
  return [...actionHeaders.keys()].length > 0 ? actionHeaders : loaderHeaders;
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Skapa grupp — Skyldig" }];
}

export async function action({ request, context }: Route.ActionArgs) {
  mutationGuard(request);
  const config = getConfig();
  const db = getDb();

  const formData = await request.formData();

  const rawName = String(formData.get("name") ?? "");
  const rawCurrency = String(formData.get("baseCurrency") ?? "SEK");
  const rawParticipants = formData.getAll("participant").map((v) => String(v));

  function genericValidationFailure() {
    return data<ActionResult>(
      {
        ok: false,
        code: "NAME_REQUIRED",
        field: "name",
        message: "Namn krävs.",
        name: rawName,
        baseCurrency: rawCurrency,
        participants: rawParticipants,
      },
      { status: 422 },
    );
  }

  // Anti-bot checks come first, before the formData is validated for real and before any
  // rate-limit budget is spent — a caught bot must not drain the rate limiter either, and it
  // must see exactly the same generic validation-failure response a normal form error would
  // produce, so it gets no signal that it was specifically caught (see docs/architecture.md
  // §4.4 and the finding this fixes).
  //
  // Honeypot: `website` is a real form field, hidden from sighted users, screen readers and
  // tab order alike (see the `aria-hidden` wrapper below — not `.sr-only`, which deliberately
  // keeps content in the accessibility tree). No legitimate browser fills it in; any value at
  // all means a bot that fills every field it finds.
  const honeypot = String(formData.get("website") ?? "");
  // Minimum time-on-page: a signed, timestamped token stamped when the form rendered (see
  // server/modules/auth/form-token.ts). Rejects a submission that arrives implausibly fast
  // (< 1.5s after render) or with a missing/invalid/stale token.
  const formToken = String(formData.get("formToken") ?? "");
  if (honeypot.length > 0 || !verifyFormToken(formToken, config.accessKeyPepper)) {
    return genericValidationFailure();
  }

  const clientIp = context.get(requestContext)?.clientIp;
  const key = clientKey({ ip: clientIp, headers: headersOf(request) }, config);

  const rateResult = checkThenGlobal(limiters.createSession, limiters.createSessionGlobal, key);
  if (!rateResult.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil(rateResult.retryAfterMs / 1000));
    return data<ActionResult>(
      { ok: false, code: "RATE_LIMITED", message: "Too many attempts." },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      },
    );
  }

  const parsed = formSchema.safeParse({
    name: formData.get("name"),
    baseCurrency: formData.get("baseCurrency"),
    participant: formData.getAll("participant").map((v) => String(v)),
  });

  if (!parsed.success) {
    return genericValidationFailure();
  }

  const participantNames = (
    Array.isArray(parsed.data.participant)
      ? parsed.data.participant
      : parsed.data.participant
        ? [parsed.data.participant]
        : []
  )
    .map((n) => n.trim())
    .filter((n) => n.length > 0);

  try {
    const result = await createSession(db, config, {
      name: parsed.data.name,
      baseCurrency: parsed.data.baseCurrency,
      participantNames,
    });

    const headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });

    await db.transaction(async (tx) => {
      const [sessionRow] = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.publicId, result.session.publicId))
        .limit(1);
      if (!sessionRow) {
        throw new Error("new: created session row not found immediately after insert");
      }
      const browserSession = await createBrowserSession(tx);
      await grantAccess(tx, browserSession.id, sessionRow.id, "admin");
      withSetCookie(headers, config, browserSession.token);
    });

    return data<ActionResult>(
      {
        ok: true,
        name: result.session.name,
        publicId: result.session.publicId,
        phrase: result.phrase,
        adminKey: result.adminKey,
        expiresAt: result.session.expiresAt.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    const actionError = toActionError(error);
    return data<ActionResult>(
      { ...actionError, name: rawName, baseCurrency: rawCurrency, participants: rawParticipants },
      { status: actionError.code === "UNEXPECTED" ? 500 : 422 },
    );
  }
}

function headersOf(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

/** Looks up a `validation.<code>` message, falling back to the generic error copy. */
function errorMessage(t: ReturnType<typeof useT>, code: string): string {
  try {
    return (t as (key: string) => string)(`validation.${code}`);
  } catch {
    return t("errors.generic");
  }
}

function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
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
      {copied ? copiedLabel : label}
    </Button>
  );
}

function ResultView({ result }: { result: CreateSuccess }) {
  const t = useT();
  const locale = useLocale();

  async function handleShare() {
    const shareText = t("create.shareText", { name: result.name, phrase: result.phrase });
    if (navigator.share) {
      try {
        await navigator.share({ text: shareText, title: result.name });
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard?.writeText(shareText);
    } catch {
      // Best effort only.
    }
  }

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-[65ch] flex-col gap-6 p-6 pb-16"
    >
      <PageHeader title={t("create.resultTitle")} lead={t("create.resultLead")} />

      <div className="rounded-card border-line bg-paper flex flex-col gap-2 border p-5">
        <p className="text-body text-pine font-medium">{result.name}</p>
        <p className="text-meta text-pine-soft">
          {t("admin.expiresLabel", { date: formatExpiryLong(result.expiresAt, toIntlLocale(locale)) })}
        </p>
      </div>

      <div className="rounded-card border-line bg-paper flex flex-col gap-2 border p-5">
        <p className="text-meta text-pine-soft font-medium">{t("create.phraseLabel")}</p>
        <p className="tabular text-lead text-pine font-semibold break-words select-all">
          {result.phrase}
        </p>
        <p className="text-meta text-pine-soft">{t("create.phraseLanguageNote")}</p>
        <div className="flex gap-3">
          <CopyButton value={result.phrase} label={t("common.copy")} copiedLabel={t("common.copied")} />
        </div>
      </div>

      <div className="rounded-card border-rust bg-rust/5 flex flex-col gap-2 border-2 p-5">
        <p className="text-meta text-rust font-medium">{t("create.adminKeyLabel")}</p>
        <p className="tabular text-lead text-pine font-semibold break-words select-all">
          {result.adminKey}
        </p>
        <p className="text-meta text-rust">{t("create.adminKeySaveNotice")}</p>
        <div className="flex gap-3">
          <CopyButton value={result.adminKey} label={t("common.copy")} copiedLabel={t("common.copied")} />
        </div>
      </div>

      <div className="flex flex-col gap-3 min-[480px]:flex-row">
        <Button type="button" variant="secondary" onClick={handleShare} fullWidth>
          {t("invite.share")}
        </Button>
        <a
          href={`/s/${result.publicId}`}
          className="rounded-control bg-pine text-lead text-paper hover:bg-pine/90 inline-flex min-h-12 w-full items-center justify-center gap-2 px-6 font-medium"
        >
          {t("create.goToSession")}
        </a>
      </div>
    </main>
  );
}

export default function NewSessionPage({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const result = actionData;

  const [participants, setParticipants] = useState<string[]>(() => {
    if (result && !result.ok && result.participants && result.participants.length > 0) {
      return result.participants;
    }
    return ["", ""];
  });

  if (result && result.ok) {
    return <ResultView result={result} />;
  }

  const error = result && !result.ok ? result : undefined;
  const fieldError = (field: string) =>
    error?.field === field ? errorMessage(t, error.code) : undefined;

  function addParticipant() {
    setParticipants((current) => [...current, ""]);
  }

  function removeParticipant(index: number) {
    setParticipants((current) => current.filter((_, i) => i !== index));
  }

  function updateParticipant(index: number, value: string) {
    setParticipants((current) => current.map((v, i) => (i === index ? value : v)));
  }

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-[65ch] flex-col gap-6 p-6 pb-16"
    >
      <PageHeader title={t("create.title")} lead={t("create.lead")} />

      {error && !error.field && (
        <p
          role="alert"
          className="rounded-control border-rust/40 bg-rust/5 text-body text-rust border p-3"
        >
          {errorMessage(t, error.code)}
        </p>
      )}

      <Form method="post" className="flex flex-col gap-6">
        {/*
          Honeypot: a decoy field no legitimate user ever fills in. Hidden from screen readers
          too (`aria-hidden`, not `.sr-only` — `.sr-only` deliberately keeps content in the
          accessibility tree for assistive tech, which is backwards here: a screen-reader user
          browsing by form field would otherwise hear a "website" field with no visual
          counterpart). Kept out of the visual layout via absolute positioning rather than
          `display:none`/`opacity:0`, which some bots skip, and out of tab order. Any value here
          means something filled every field it found — see the action's anti-bot check above.
        */}
        <div aria-hidden="true" className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0">
          <input id="website" type="text" name="website" tabIndex={-1} autoComplete="off" />
        </div>
        <input type="hidden" name="formToken" value={loaderData.formToken} />

        <Field htmlFor="name" label={t("create.nameLabel")} error={fieldError("name")}>
          {(ids) => (
            <Input
              {...ids}
              name="name"
              placeholder={t("create.namePlaceholder")}
              maxLength={80}
              required
              defaultValue={error?.name ?? ""}
            />
          )}
        </Field>

        <Field htmlFor="baseCurrency" label={t("create.baseCurrencyLabel")}>
          {(ids) => (
            <Select {...ids} name="baseCurrency" defaultValue={error?.baseCurrency ?? "SEK"}>
              {loaderData.currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="flex flex-col gap-3">
          <span className="text-body text-pine font-medium">{t("create.participantsLabel")}</span>
          {participants.map((value, index) => (
            <div key={index} className="flex items-center gap-2">
              <label htmlFor={`participant-${index}`} className="sr-only">
                {t("create.participantsLabel")} {index + 1}
              </label>
              <Input
                id={`participant-${index}`}
                name="participant"
                value={value}
                onChange={(e) => updateParticipant(index, e.target.value)}
                maxLength={40}
                className="flex-1"
              />
              {participants.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Ta bort deltagare ${index + 1}`}
                  onClick={() => removeParticipant(index)}
                >
                  {t("common.delete")}
                </Button>
              )}
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={addParticipant}>
            {t("create.addParticipant")}
          </Button>
        </div>

        <Button type="submit" size="lg" loading={submitting} fullWidth>
          {t("create.submit")}
        </Button>
      </Form>
    </main>
  );
}
