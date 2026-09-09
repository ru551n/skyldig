import { useState } from "react";
import { data, redirect, useFetcher } from "react-router";

import { requireSessionAccess } from "@server/modules/auth/session-auth.ts";
import { listRevisionsForEntity } from "@server/modules/audit/audit.ts";
import { NotFoundError } from "@server/modules/shared/errors.ts";
import { deletePayment, getPayment, type PaymentDto } from "@server/modules/payments/payments.ts";

import { describeRate } from "~/components/expense/historyDiff.ts";
import { RevisionHistory } from "~/components/payment/RevisionHistory.tsx";
import {
  Arrow,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  Money,
  PageHeader,
} from "~/components/ui/index.ts";
import { formatExpiryLong } from "~/lib/format.ts";
import {
  getConfig,
  getDb,
  mutationGuard,
  toActionError,
  type ActionError,
} from "~/lib/session-context.server.ts";
import { toIntlLocale, useLocale, useT } from "~/i18n";

import type { Route } from "./+types/payment-detail";

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid);

  const revisions = await listRevisionsForEntity(db, access.session.id, "payment", params.pid);

  let payment: PaymentDto | null = null;
  try {
    payment = await getPayment(db, access.session.id, params.pid);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }

  if (!payment && revisions.length === 0) {
    throw new Response("Not Found", { status: 404 });
  }

  return {
    sessionPublicId: access.session.publicId,
    baseCurrency: access.session.baseCurrency,
    payment,
    revisions,
  };
}

type ActionResult = ActionError;

export async function action({ request, params }: Route.ActionArgs) {
  mutationGuard(request);
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid);
  const formData = await request.formData();
  const expectedRevision = Number(formData.get("revision") ?? "0");

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
    return data<ActionResult>(actionError, {
      status: actionError.code === "UNEXPECTED" ? 500 : 422,
    });
  }

  return redirect(`/s/${params.sid}`);
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Betalning — Skyldig" }];
}

function errorMessage(t: ReturnType<typeof useT>, code: string): string {
  try {
    return (t as (key: string) => string)(`validation.${code}`);
  } catch {
    return t("errors.generic");
  }
}

export default function PaymentDetailPage({ loaderData, params }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const { payment, baseCurrency, revisions } = loaderData;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteFetcher = useFetcher<ActionResult>();
  const deletePending = deleteFetcher.state !== "idle";

  if (!payment) {
    return (
      <div className="mx-auto flex max-w-[65ch] flex-col gap-6 p-4 pb-16">
        <PageHeader title={t("payment.detailTitle")} />
        <p
          role="status"
          className="rounded-card border-line bg-paper text-body text-pine-soft border p-4"
        >
          {t("payment.deletedNotice")}
        </p>
        <section className="flex flex-col gap-3">
          <h2 className="text-h2 text-pine font-semibold">{t("expense.history")}</h2>
          <RevisionHistory revisions={revisions} />
        </section>
      </div>
    );
  }

  const isForeign = payment.currencyCode !== baseCurrency;
  const rateWords = describeRate(
    payment.rateText,
    payment.rateDirection,
    payment.currencyCode,
    baseCurrency,
  );

  return (
    <div className="mx-auto flex max-w-[65ch] flex-col gap-6 p-4 pb-16">
      <PageHeader
        title={t("payment.detailTitle")}
        right={
          <ButtonLink to={`/s/${params.sid}/betalningar/${params.pid}/andra`}>
            {t("common.edit")}
          </ButtonLink>
        }
      />

      <Card tinted className="flex flex-col items-center gap-2 py-6">
        <div className="text-body text-pine flex items-center gap-3 font-medium">
          <span>{payment.payer.displayName}</span>
          <Arrow aria-hidden="true" />
          <span>{payment.recipient.displayName}</span>
        </div>
        <span className="sr-only">
          {t("payment.directionSr", {
            from: payment.payer.displayName,
            to: payment.recipient.displayName,
          })}
        </span>
        <Money
          amountMinor={BigInt(payment.amountMinor)}
          currency={payment.currencyCode}
          size="hero"
        />
        {isForeign && (
          <>
            <p className="text-body text-pine-soft">
              ≈ <Money amountMinor={BigInt(payment.baseAmountMinor)} currency={baseCurrency} />
            </p>
            {rateWords && <p className="text-meta text-pine-soft">{rateWords}</p>}
          </>
        )}
      </Card>

      <Card>
        <p className="text-meta text-pine-soft">{formatExpiryLong(payment.paymentDate, toIntlLocale(locale))}</p>
        {payment.note && <p className="text-body text-pine-soft mt-2">{payment.note}</p>}
      </Card>

      <Button
        type="button"
        variant="danger"
        onClick={() => setDeleteOpen(true)}
        className="self-start"
      >
        {t("payment.delete")}
      </Button>
      {deleteFetcher.data && !deleteFetcher.data.ok && (
        <p role="alert" className="text-body text-rust">
          {errorMessage(t, deleteFetcher.data.code)}
        </p>
      )}

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
          deleteFetcher.submit({ revision: String(payment.revision) }, { method: "post" });
        }}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 text-pine font-semibold">{t("expense.history")}</h2>
        <RevisionHistory revisions={revisions} />
      </section>
    </div>
  );
}
