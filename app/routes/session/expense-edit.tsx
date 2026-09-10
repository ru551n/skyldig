import { useState } from "react";
import { data, redirect, useFetcher, useNavigation } from "react-router";

import { listCurrencies } from "@domain/currency/registry.ts";
import { formatMinorAsDecimal, formatMoney } from "@domain/money/money.ts";
import type { CurrencyDecimals } from "@domain/currency/registry.ts";
import { requireSessionAccess } from "@server/modules/auth/session-auth.ts";
import {
  deleteExpense,
  getExpense,
  suggestRate,
  updateExpense,
  type ExpenseDto,
  type RateDirection,
} from "@server/modules/expenses/expenses.ts";
import { listParticipants } from "@server/modules/participants/participants.ts";

import { ExpenseForm, type ExpenseFormDefaults } from "~/components/expense/ExpenseForm.tsx";
import { Button, ConfirmDialog, PageHeader } from "~/components/ui/index.ts";
import {
  getConfig,
  getDb,
  mutationGuard,
  toActionError,
  type ActionError,
} from "~/lib/session-context.server.ts";
import { requestContext } from "~/context.ts";
import { localeFromMatches, t, toIntlLocale, useLocale, useT } from "~/i18n";

import type { Route } from "./+types/expense-edit";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const locale = context.get(requestContext)?.locale ?? "sv";
  const access = await requireSessionAccess(db, request, config, params.sid);
  const [participants, expense] = await Promise.all([
    listParticipants(db, access.session.id),
    getExpense(db, access.session.id, params.eid),
  ]);

  const url = new URL(request.url);
  const currency = url.searchParams.get("currency");
  let suggestedRate: { rateText: string; rateDirection: RateDirection } | null = null;
  if (currency && currency !== access.session.baseCurrency) {
    suggestedRate = await suggestRate(db, access.session.id, currency);
  }

  return {
    sessionPublicId: access.session.publicId,
    baseCurrency: access.session.baseCurrency,
    participants: participants.map((p) => ({
      publicId: p.publicId,
      displayName: p.displayName,
      position: p.position,
    })),
    currencies: listCurrencies(locale),
    suggestedRate,
    expense,
  };
}

type ActionResult = ActionError & { intent?: "update" | "delete" };

export async function action({ request, params }: Route.ActionArgs) {
  mutationGuard(request);
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid);

  const formData = await request.formData();
  const intent = String(formData.get("_intent") ?? "update");
  const expectedRevision = Number(formData.get("revision") ?? "0");

  if (intent === "delete") {
    try {
      await db.transaction(async (tx) => {
        await deleteExpense(
          tx,
          { id: access.session.id, baseCurrency: access.session.baseCurrency },
          params.eid,
          expectedRevision,
        );
      });
    } catch (error) {
      const actionError = toActionError(error);
      return data<ActionResult>(
        { ...actionError, intent: "delete" },
        { status: actionError.code === "UNEXPECTED" ? 500 : 422 },
      );
    }
    return redirect(`/s/${params.sid}`);
  }

  const input = {
    description: String(formData.get("description") ?? ""),
    amountText: String(formData.get("amountText") ?? ""),
    currencyCode: String(formData.get("currencyCode") ?? access.session.baseCurrency),
    rateText: formData.get("rateText") ? String(formData.get("rateText")) : undefined,
    rateDirection: formData.get("rateDirection")
      ? (String(formData.get("rateDirection")) as RateDirection)
      : undefined,
    payerPublicId: String(formData.get("payerPublicId") ?? ""),
    participantPublicIds: formData.getAll("participantPublicIds").map((v) => String(v)),
    expenseDate: String(formData.get("expenseDate") ?? ""),
    note: formData.get("note") ? String(formData.get("note")) : undefined,
  };

  try {
    await db.transaction(async (tx) => {
      await updateExpense(
        tx,
        { id: access.session.id, baseCurrency: access.session.baseCurrency },
        params.eid,
        input,
        expectedRevision,
      );
    });
  } catch (error) {
    const actionError = toActionError(error);
    return data<ActionResult>(
      { ...actionError, intent: "update" },
      { status: actionError.code === "UNEXPECTED" ? 500 : 422 },
    );
  }

  return redirect(`/s/${params.sid}/utgifter/${params.eid}`);
}

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: `${t(localeFromMatches(matches), "expense.editTitle")} — Skyldig` }];
}

function errorMessage(t: ReturnType<typeof useT>, code: string): string {
  try {
    return (t as (key: string) => string)(`validation.${code}`);
  } catch {
    return t("errors.generic");
  }
}

function ConflictBanner({ current }: { current: ExpenseDto }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div
      role="alert"
      className="rounded-card border-rust bg-rust/5 flex flex-col gap-3 border-2 p-4"
    >
      <p className="text-body text-rust font-semibold">{t("expense.conflictTitle")}</p>
      <p className="text-meta text-pine-soft">{t("expense.conflictBody")}</p>
      <dl className="text-meta text-pine flex flex-col gap-1">
        <div className="flex justify-between">
          <dt>{t("expense.fieldDescription")}</dt>
          <dd>{current.description}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t("expense.fieldAmount")}</dt>
          <dd>{formatMoney(BigInt(current.amountMinor), current.currencyCode, toIntlLocale(locale))}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t("expense.fieldPayer")}</dt>
          <dd>{current.payer.displayName}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t("expense.fieldDate")}</dt>
          <dd>{current.expenseDate}</dd>
        </div>
      </dl>
      <Button
        type="button"
        variant="secondary"
        onClick={() => window.location.reload()}
        className="self-start"
      >
        {t("common.reload")}
      </Button>
    </div>
  );
}

export default function ExpenseEditPage({ loaderData, actionData, params }: Route.ComponentProps) {
  const t = useT();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteFetcher = useFetcher<ActionResult>();
  const deletePending = deleteFetcher.state !== "idle";

  const error = actionData?.intent === "update" ? actionData : undefined;
  const deleteError = deleteFetcher.data?.intent === "delete" ? deleteFetcher.data : undefined;
  const conflict =
    error?.code === "CONFLICT" ? (error.current as unknown as ExpenseDto) : undefined;

  const expense = loaderData.expense;
  const defaults: ExpenseFormDefaults = {
    description: expense.description,
    amountText: formatMinorAsDecimal(
      BigInt(expense.amountMinor),
      decimalsFor(expense.currencyCode, loaderData.currencies) as CurrencyDecimals,
    ),
    currencyCode: expense.currencyCode,
    rateText: expense.rateText ?? "",
    rateDirection: (expense.rateDirection ?? "base_per_unit") as "base_per_unit" | "units_per_base",
    payerPublicId: expense.payer.publicId,
    participantPublicIds: expense.participants.map((p) => p.publicId),
    expenseDate: expense.expenseDate,
    note: expense.note ?? "",
  };

  return (
    <div className="mx-auto flex max-w-[65ch] flex-col gap-6 p-4 pb-16">
      <PageHeader title={t("expense.editTitle")} />

      {conflict && <ConflictBanner current={conflict} />}

      <ExpenseForm
        participants={loaderData.participants}
        currencies={loaderData.currencies}
        baseCurrency={loaderData.baseCurrency}
        sessionPublicId={loaderData.sessionPublicId}
        defaults={defaults}
        error={error}
        errorMessage={(code) => errorMessage(t, code)}
        revision={expense.revision}
        submitting={submitting}
        submitLabel={t("expense.submit")}
      />

      <div className="border-line flex flex-col gap-2 border-t pt-4">
        {deleteError && !deleteError.field && (
          <p role="alert" className="text-body text-rust">
            {errorMessage(t, deleteError.code)}
          </p>
        )}
        <Button
          type="button"
          variant="danger"
          onClick={() => setDeleteOpen(true)}
          className="self-start"
        >
          {t("expense.delete")}
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("expense.deleteConfirmTitle")}
        body={t("expense.deleteConfirmBody")}
        confirmLabel={t("expense.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        pending={deletePending}
        onConfirm={() => {
          deleteFetcher.submit(
            { _intent: "delete", revision: String(expense.revision) },
            { method: "post", action: `/s/${params.sid}/utgifter/${params.eid}/andra` },
          );
        }}
      />
    </div>
  );
}

function decimalsFor(code: string, currencies: { code: string; decimals: number }[]): number {
  return currencies.find((c) => c.code === code)?.decimals ?? 2;
}
