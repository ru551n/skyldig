import { useState } from "react";
import { data, redirect, useFetcher, useNavigation } from "react-router";

import { listCurrencies } from "@domain/currency/registry.ts";
import { formatMinorAsDecimal, formatMoney } from "@domain/money/money.ts";
import type { CurrencyDecimals } from "@domain/currency/registry.ts";
import { requireSessionAccess } from "@server/modules/auth/session-auth.ts";
import { suggestRate, type RateDirection } from "@server/modules/expenses/expenses.ts";
import {
  deletePayment,
  getPayment,
  updatePayment,
  type PaymentDto,
} from "@server/modules/payments/payments.ts";
import { listParticipants } from "@server/modules/participants/participants.ts";

import { PaymentForm, type PaymentFormDefaults } from "~/components/payment/PaymentForm.tsx";
import { Button, ConfirmDialog, PageHeader } from "~/components/ui/index.ts";
import {
  getConfig,
  getDb,
  mutationGuard,
  toActionError,
  type ActionError,
} from "~/lib/session-context.server.ts";
import { toIntlLocale, useLocale, useT } from "~/i18n";

import type { Route } from "./+types/payment-edit";

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid);
  const [participants, payment] = await Promise.all([
    listParticipants(db, access.session.id),
    getPayment(db, access.session.id, params.pid),
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
    participants: participants.map((p) => ({ publicId: p.publicId, displayName: p.displayName })),
    currencies: listCurrencies(),
    suggestedRate,
    payment,
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
        await deletePayment(
          tx,
          { id: access.session.id, baseCurrency: access.session.baseCurrency },
          params.pid,
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
    amountText: String(formData.get("amountText") ?? ""),
    currencyCode: String(formData.get("currencyCode") ?? access.session.baseCurrency),
    rateText: formData.get("rateText") ? String(formData.get("rateText")) : undefined,
    rateDirection: formData.get("rateDirection")
      ? (String(formData.get("rateDirection")) as RateDirection)
      : undefined,
    payerPublicId: String(formData.get("payerPublicId") ?? ""),
    recipientPublicId: String(formData.get("recipientPublicId") ?? ""),
    paymentDate: String(formData.get("paymentDate") ?? ""),
    note: formData.get("note") ? String(formData.get("note")) : undefined,
  };

  try {
    await db.transaction(async (tx) => {
      await updatePayment(
        tx,
        { id: access.session.id, baseCurrency: access.session.baseCurrency },
        params.pid,
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

  return redirect(`/s/${params.sid}/betalningar/${params.pid}`);
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Ändra betalning — Skyldig" }];
}

function errorMessage(t: ReturnType<typeof useT>, code: string): string {
  try {
    return (t as (key: string) => string)(`validation.${code}`);
  } catch {
    return t("errors.generic");
  }
}

function ConflictBanner({ current }: { current: PaymentDto }) {
  const t = useT();
  const locale = useLocale();
  return (
    <div
      role="alert"
      className="rounded-card border-rust bg-rust/5 flex flex-col gap-3 border-2 p-4"
    >
      <p className="text-body text-rust font-semibold">{t("payment.conflictTitle")}</p>
      <p className="text-meta text-pine-soft">{t("payment.conflictBody")}</p>
      <dl className="text-meta text-pine flex flex-col gap-1">
        <div className="flex justify-between">
          <dt>{t("expense.fieldAmount")}</dt>
          <dd>{formatMoney(BigInt(current.amountMinor), current.currencyCode, toIntlLocale(locale))}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t("payment.fieldPayer")}</dt>
          <dd>{current.payer.displayName}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t("payment.fieldRecipient")}</dt>
          <dd>{current.recipient.displayName}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t("expense.fieldDate")}</dt>
          <dd>{current.paymentDate}</dd>
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

export default function PaymentEditPage({ loaderData, actionData, params }: Route.ComponentProps) {
  const t = useT();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteFetcher = useFetcher<ActionResult>();
  const deletePending = deleteFetcher.state !== "idle";

  const error = actionData?.intent === "update" ? actionData : undefined;
  const deleteError = deleteFetcher.data?.intent === "delete" ? deleteFetcher.data : undefined;
  const conflict =
    error?.code === "CONFLICT" ? (error.current as unknown as PaymentDto) : undefined;

  const payment = loaderData.payment;
  const decimals =
    loaderData.currencies.find((c) => c.code === payment.currencyCode)?.decimals ?? 2;
  const defaults: PaymentFormDefaults = {
    amountText: formatMinorAsDecimal(BigInt(payment.amountMinor), decimals as CurrencyDecimals),
    currencyCode: payment.currencyCode,
    rateText: payment.rateText ?? "",
    rateDirection: (payment.rateDirection ?? "base_per_unit") as "base_per_unit" | "units_per_base",
    payerPublicId: payment.payer.publicId,
    recipientPublicId: payment.recipient.publicId,
    paymentDate: payment.paymentDate,
    note: payment.note ?? "",
  };

  return (
    <div className="mx-auto flex max-w-[65ch] flex-col gap-6 p-4 pb-16">
      <PageHeader title={t("payment.editTitle")} />

      {conflict && <ConflictBanner current={conflict} />}

      <PaymentForm
        participants={loaderData.participants}
        currencies={loaderData.currencies}
        baseCurrency={loaderData.baseCurrency}
        defaults={defaults}
        error={error}
        errorMessage={(code) => errorMessage(t, code)}
        revision={payment.revision}
        submitting={submitting}
        submitLabel={t("payment.submit")}
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
          {t("payment.delete")}
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("payment.deleteConfirmTitle")}
        body={t("payment.deleteConfirmBody")}
        confirmLabel={t("payment.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        pending={deletePending}
        onConfirm={() => {
          deleteFetcher.submit(
            { _intent: "delete", revision: String(payment.revision) },
            { method: "post", action: `/s/${params.sid}/betalningar/${params.pid}/andra` },
          );
        }}
      />
    </div>
  );
}
