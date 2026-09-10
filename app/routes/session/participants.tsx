import { useEffect, useState } from "react";
import { data, Form, useFetcher, useNavigation } from "react-router";
import { z } from "zod";

import { requireSessionAccess } from "@server/modules/auth/session-auth.ts";
import { getSessionBalances } from "@server/modules/balances/balances.ts";
import {
  addParticipant,
  deleteParticipant,
  renameParticipant,
  listParticipants,
  type ParticipantDto,
} from "@server/modules/participants/participants.ts";

import {
  Avatar,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  Money,
  PageHeader,
} from "~/components/ui/index.ts";
import {
  getConfig,
  getDb,
  mutationGuard,
  toActionError,
  type ActionError,
} from "~/lib/session-context.server.ts";
import { requestContext } from "~/context.ts";
import { t, useT } from "~/i18n";

import type { Route } from "./+types/participants";

const addSchema = z.object({ displayName: z.string().trim().min(1).max(40) });
const renameSchema = z.object({
  participantId: z.string().trim().min(1),
  displayName: z.string().trim().min(1).max(40),
  revision: z.coerce.number().int().min(0),
});
const deleteSchema = z.object({
  participantId: z.string().trim().min(1),
  revision: z.coerce.number().int().min(0),
});

interface BalanceInfo {
  net: bigint;
  hasHistory: boolean;
}

interface LoaderData {
  participants: ParticipantDto[];
  balances: Record<string, BalanceInfo>;
  baseCurrency: string;
}

type ActionResult =
  (ActionError & { intent: string; participantId?: string }) | { ok: true; intent: string };

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid);

  const [participantList, sessionBalances] = await Promise.all([
    listParticipants(db, access.session.id),
    getSessionBalances(db, { id: access.session.id, baseCurrency: access.session.baseCurrency }),
  ]);

  const balances: Record<string, BalanceInfo> = {};
  for (const b of sessionBalances.balances) {
    balances[b.publicId] = {
      net: b.net,
      hasHistory: b.paid !== 0n || b.share !== 0n || b.repaid !== 0n || b.received !== 0n,
    };
  }

  return data<LoaderData>({
    participants: participantList,
    balances,
    baseCurrency: access.session.baseCurrency,
  });
}

export async function action({ request, params, context }: Route.ActionArgs) {
  mutationGuard(request);
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid);
  const locale = context.get(requestContext)?.locale ?? "sv";
  const formData = await request.formData();
  const intent = String(formData.get("_intent") ?? "");

  try {
    if (intent === "add") {
      const parsed = addSchema.safeParse({ displayName: formData.get("displayName") });
      if (!parsed.success) {
        return data<ActionResult>(
          {
            ok: false,
            code: "NAME_REQUIRED",
            field: "displayName",
            message: t(locale, "validation.NAME_REQUIRED"),
            intent,
          },
          { status: 422 },
        );
      }
      await db.transaction(async (tx) => {
        await addParticipant(tx, access.session.id, parsed.data.displayName);
      });
      return data<ActionResult>({ ok: true, intent });
    }

    if (intent === "rename") {
      const parsed = renameSchema.safeParse({
        participantId: formData.get("participantId"),
        displayName: formData.get("displayName"),
        revision: formData.get("revision"),
      });
      if (!parsed.success) {
        return data<ActionResult>(
          {
            ok: false,
            code: "NAME_REQUIRED",
            field: "displayName",
            message: t(locale, "validation.NAME_REQUIRED"),
            intent,
            participantId: String(formData.get("participantId") ?? ""),
          },
          { status: 422 },
        );
      }
      await db.transaction(async (tx) => {
        await renameParticipant(
          tx,
          access.session.id,
          parsed.data.participantId,
          parsed.data.displayName,
          parsed.data.revision,
        );
      });
      return data<ActionResult>({ ok: true, intent });
    }

    if (intent === "delete") {
      const parsed = deleteSchema.safeParse({
        participantId: formData.get("participantId"),
        revision: formData.get("revision"),
      });
      if (!parsed.success) {
        throw new Response("Bad Request", { status: 400 });
      }
      await db.transaction(async (tx) => {
        await deleteParticipant(
          tx,
          access.session.id,
          parsed.data.participantId,
          parsed.data.revision,
        );
      });
      return data<ActionResult>({ ok: true, intent });
    }

    throw new Response("Bad Request", { status: 400 });
  } catch (error) {
    const actionError = toActionError(error);
    const participantId = String(formData.get("participantId") ?? "") || undefined;
    const status =
      actionError.code === "CONFLICT" ? 409 : actionError.code === "UNEXPECTED" ? 500 : 422;
    return data<ActionResult>({ ...actionError, intent, participantId }, { status });
  }
}

/** Looks up a `validation.<code>` message, falling back to the generic error copy. */
function errorMessage(t: ReturnType<typeof useT>, code: string): string {
  try {
    return (t as (key: string) => string)(`validation.${code}`);
  } catch {
    return t("errors.generic");
  }
}

interface RowProps {
  participant: ParticipantDto;
  position: number;
  currency: string;
  balance: BalanceInfo | undefined;
}

function ParticipantRow({ participant, position, currency, balance }: RowProps) {
  const t = useT();
  const renameFetcher = useFetcher<ActionResult>();
  const deleteFetcher = useFetcher<ActionResult>();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (
      renameFetcher.state === "idle" &&
      renameFetcher.data &&
      "ok" in renameFetcher.data &&
      renameFetcher.data.ok
    ) {
      setRenameOpen(false);
    }
  }, [renameFetcher.state, renameFetcher.data]);

  useEffect(() => {
    if (
      deleteFetcher.state === "idle" &&
      deleteFetcher.data &&
      "ok" in deleteFetcher.data &&
      deleteFetcher.data.ok
    ) {
      setDeleteOpen(false);
    }
  }, [deleteFetcher.state, deleteFetcher.data]);

  const renameError =
    renameFetcher.data &&
    !renameFetcher.data.ok &&
    renameFetcher.data.participantId === participant.publicId
      ? renameFetcher.data
      : undefined;
  const deleteError =
    deleteFetcher.data &&
    !deleteFetcher.data.ok &&
    deleteFetcher.data.participantId === participant.publicId
      ? deleteFetcher.data
      : undefined;

  const net = balance?.net ?? 0n;
  const hasHistory = balance?.hasHistory ?? false;

  function confirmDelete() {
    const formData = new FormData();
    formData.set("_intent", "delete");
    formData.set("participantId", participant.publicId);
    formData.set("revision", String(participant.revision));
    deleteFetcher.submit(formData, { method: "post" });
  }

  return (
    <li className="border-line flex flex-col gap-2 border-b py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <Avatar name={participant.displayName} position={position} />
        <span className="text-body text-pine flex-1 truncate font-medium">
          {participant.displayName}
        </span>
        <Money amountMinor={net} currency={currency} signed size="body" />
      </div>

      <div className="flex flex-wrap items-center gap-2 pl-12">
        <Button type="button" variant="ghost" onClick={() => setRenameOpen(true)}>
          {t("participants.rename")}
        </Button>
        {hasHistory ? (
          <p className="text-meta text-pine-soft">{t("participants.cannotDeleteHistory")}</p>
        ) : (
          <Button type="button" variant="ghost" onClick={() => setDeleteOpen(true)}>
            {t("common.delete")}
          </Button>
        )}
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen} title={t("participants.rename")}>
        <renameFetcher.Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="_intent" value="rename" />
          <input type="hidden" name="participantId" value={participant.publicId} />
          <input type="hidden" name="revision" value={participant.revision} />
          <Field
            htmlFor={`rename-${participant.publicId}`}
            label={t("participants.newNameLabel")}
            error={
              renameError?.field === "displayName"
                ? renameError.code === "PARTICIPANT_NAME_TAKEN"
                  ? t("participants.nameTaken")
                  : errorMessage(t, renameError.code)
                : undefined
            }
          >
            {(ids) => (
              <Input
                {...ids}
                name="displayName"
                maxLength={40}
                required
                defaultValue={participant.displayName}
                autoFocus
              />
            )}
          </Field>
          {renameError && renameError.code === "CONFLICT" && (
            <p role="alert" className="text-meta text-rust font-medium">
              {t("participants.conflict")}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setRenameOpen(false)}>
              {t("participants.renameCancel")}
            </Button>
            <Button type="submit" loading={renameFetcher.state !== "idle"}>
              {t("common.save")}
            </Button>
          </div>
        </renameFetcher.Form>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("participants.removeConfirmTitle")}
        body={
          deleteError
            ? deleteError.code === "CONFLICT"
              ? t("participants.conflict")
              : errorMessage(t, deleteError.code)
            : t("participants.removeConfirmBody")
        }
        confirmLabel={t("common.delete")}
        destructive
        pending={deleteFetcher.state !== "idle"}
        onConfirm={confirmDelete}
      />
    </li>
  );
}

export default function ParticipantsPage({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const addError =
    actionData && !actionData.ok && actionData.intent === "add" ? actionData : undefined;

  return (
    <div className="mx-auto flex min-h-screen max-w-[65ch] flex-col gap-6 p-6 pb-16">
      <PageHeader
        title={t("participants.title")}
        lead={t("participants.count", { n: loaderData.participants.length })}
      />

      {loaderData.participants.length === 0 ? (
        <EmptyState
          headline={t("participants.noParticipants")}
          body={t("participants.emptyBody")}
        />
      ) : (
        <ul className="rounded-card border-line bg-paper border px-4">
          {loaderData.participants.map((p, index) => (
            <ParticipantRow
              key={p.publicId}
              participant={p}
              position={index}
              currency={loaderData.baseCurrency}
              balance={loaderData.balances[p.publicId]}
            />
          ))}
        </ul>
      )}

      <section className="rounded-card border-line bg-paper flex flex-col gap-3 border p-5">
        <h2 className="text-lead text-pine font-semibold">{t("participants.addTitle")}</h2>
        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="_intent" value="add" />
          <Field
            htmlFor="displayName"
            label={t("participants.nameLabel")}
            error={
              addError?.field === "displayName"
                ? addError.code === "PARTICIPANT_NAME_TAKEN"
                  ? t("participants.nameTaken")
                  : errorMessage(t, addError.code)
                : undefined
            }
          >
            {(ids) => (
              <Input
                {...ids}
                name="displayName"
                placeholder={t("participants.addNamePlaceholder")}
                maxLength={40}
                required
              />
            )}
          </Field>
          <Button type="submit" size="lg" loading={submitting} fullWidth>
            {t("participants.add")}
          </Button>
        </Form>
      </section>
    </div>
  );
}
