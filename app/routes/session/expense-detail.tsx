import { useState } from "react";
import { data, redirect, useFetcher } from "react-router";

import { requireSessionAccess } from "@server/modules/auth/session-auth.ts";
import { listRevisionsForEntity } from "@server/modules/audit/audit.ts";
import { NotFoundError } from "@server/modules/shared/errors.ts";
import { deleteExpense, getExpense, type ExpenseDto } from "@server/modules/expenses/expenses.ts";

import { describeRate } from "~/components/expense/historyDiff.ts";
import { RevisionHistory } from "~/components/expense/RevisionHistory.tsx";
import { Button, ButtonLink, Card, ConfirmDialog, Money, PageHeader } from "~/components/ui/index.ts";
import { formatExpiryLong } from "~/lib/format.ts";
import { getConfig, getDb, mutationGuard, toActionError, type ActionError } from "~/lib/session-context.server.ts";
import { useT } from "~/i18n";

import type { Route } from "./+types/expense-detail";

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid);

  const revisions = await listRevisionsForEntity(db, access.session.id, "expense", params.eid);

  let expense: ExpenseDto | null = null;
  try {
    expense = await getExpense(db, access.session.id, params.eid);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }

  if (!expense && revisions.length === 0) {
    throw new Response("Not Found", { status: 404 });
  }

  return {
    sessionPublicId: access.session.publicId,
    baseCurrency: access.session.baseCurrency,
    expense,
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
      await deleteExpense(tx, { id: access.session.id, baseCurrency: access.session.baseCurrency }, params.eid, expectedRevision);
    });
  } catch (error) {
    const actionError = toActionError(error);
    return data<ActionResult>(actionError, { status: actionError.code === "UNEXPECTED" ? 500 : 422 });
  }

  return redirect(`/s/${params.sid}`);
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.expense?.description ?? "Utgift"} — Skyldig` }];
}

function errorMessage(t: ReturnType<typeof useT>, code: string): string {
  try {
    return (t as (key: string) => string)(`validation.${code}`);
  } catch {
    return t("errors.generic");
  }
}

export default function ExpenseDetailPage({ loaderData, params }: Route.ComponentProps) {
  const t = useT();
  const { expense, baseCurrency, revisions } = loaderData;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteFetcher = useFetcher<ActionResult>();
  const deletePending = deleteFetcher.state !== "idle";

  if (!expense) {
    return (
      <main id="main" className="mx-auto flex max-w-[65ch] flex-col gap-6 p-4 pb-16">
        <PageHeader title={t("expense.detailTitle")} />
        <p role="status" className="rounded-card border border-line bg-paper p-4 text-body text-pine-soft">
          {t("expense.deletedNotice")}
        </p>
        <section className="flex flex-col gap-3">
          <h2 className="text-h2 font-semibold text-pine">{t("expense.history")}</h2>
          <RevisionHistory revisions={revisions} />
        </section>
      </main>
    );
  }

  const isForeign = expense.currencyCode !== baseCurrency;
  const rateWords = describeRate(expense.rateText, expense.rateDirection, expense.currencyCode, baseCurrency);

  return (
    <main id="main" className="mx-auto flex max-w-[65ch] flex-col gap-6 p-4 pb-16">
      <PageHeader title={expense.description} right={<ButtonLink to={`/s/${params.sid}/utgifter/${params.eid}/andra`}>{t("common.edit")}</ButtonLink>} />

      <div className="flex flex-col gap-1">
        <Money amountMinor={BigInt(expense.amountMinor)} currency={expense.currencyCode} size="hero" />
        {isForeign && (
          <>
            <p className="text-body text-pine-soft">
              ≈ <Money amountMinor={BigInt(expense.baseAmountMinor)} currency={baseCurrency} />
            </p>
            {rateWords && <p className="text-meta text-pine-soft">{rateWords}</p>}
          </>
        )}
      </div>

      <Card>
        <p className="text-body text-pine">{t("expense.paidBy", { name: expense.payer.displayName })}</p>
        <p className="mt-1 text-meta text-pine-soft">{formatExpiryLong(expense.expenseDate)}</p>
        {expense.note && <p className="mt-2 text-body text-pine-soft">{expense.note}</p>}
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-h2 font-semibold text-pine">{t("expense.sharesLabel")}</h2>
        <Card className="flex flex-col divide-y divide-line p-0">
          {expense.participants.map((p) => (
            <div key={p.publicId} className="flex items-center justify-between px-4 py-3">
              <span className="text-body text-pine">{p.displayName}</span>
              <Money amountMinor={BigInt(p.shareBaseMinor)} currency={baseCurrency} />
            </div>
          ))}
        </Card>
      </section>

      <Button type="button" variant="danger" onClick={() => setDeleteOpen(true)} className="self-start">
        {t("expense.delete")}
      </Button>
      {deleteFetcher.data && !deleteFetcher.data.ok && (
        <p role="alert" className="text-body text-rust">
          {errorMessage(t, deleteFetcher.data.code)}
        </p>
      )}

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
          deleteFetcher.submit({ revision: String(expense.revision) }, { method: "post" });
        }}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold text-pine">{t("expense.history")}</h2>
        <RevisionHistory revisions={revisions} />
      </section>
    </main>
  );
}
