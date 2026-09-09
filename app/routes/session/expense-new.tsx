import { data, redirect, useNavigation } from "react-router";

import { listCurrencies } from "@domain/currency/registry.ts";
import { requireSessionAccess } from "@server/modules/auth/session-auth.ts";
import {
  createExpense,
  suggestRate,
  type RateDirection,
} from "@server/modules/expenses/expenses.ts";
import { listParticipants } from "@server/modules/participants/participants.ts";

import { ExpenseForm, type ExpenseFormDefaults } from "~/components/expense/ExpenseForm.tsx";
import { PageHeader } from "~/components/ui/index.ts";
import {
  getConfig,
  getDb,
  mutationGuard,
  toActionError,
  type ActionError,
} from "~/lib/session-context.server.ts";
import { useT } from "~/i18n";

import type { Route } from "./+types/expense-new";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid);
  const participants = await listParticipants(db, access.session.id);

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
  };
}

type ActionResult = ActionError;

export async function action({ request, params }: Route.ActionArgs) {
  mutationGuard(request);
  const db = getDb();
  const config = getConfig();
  const access = await requireSessionAccess(db, request, config, params.sid);

  const formData = await request.formData();
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
      await createExpense(
        tx,
        { id: access.session.id, baseCurrency: access.session.baseCurrency },
        input,
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
  return [{ title: "Ny utgift — Skyldig" }];
}

function errorMessage(t: ReturnType<typeof useT>, code: string): string {
  try {
    return (t as (key: string) => string)(`validation.${code}`);
  } catch {
    return t("errors.generic");
  }
}

export default function ExpenseNewPage({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT();
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const error = actionData;

  const defaults: ExpenseFormDefaults = {
    description: "",
    amountText: "",
    currencyCode: loaderData.baseCurrency,
    rateText: "",
    rateDirection: "base_per_unit",
    payerPublicId: loaderData.participants[0]?.publicId ?? "",
    participantPublicIds: loaderData.participants.map((p) => p.publicId),
    expenseDate: todayIso(),
    note: "",
  };

  return (
    <div className="mx-auto flex max-w-[65ch] flex-col gap-6 p-4 pb-16">
      <PageHeader title={t("expense.newTitle")} />
      <ExpenseForm
        participants={loaderData.participants}
        currencies={loaderData.currencies}
        baseCurrency={loaderData.baseCurrency}
        defaults={defaults}
        error={error}
        errorMessage={(code) => errorMessage(t, code)}
        submitting={submitting}
        submitLabel={t("expense.submit")}
      />
    </div>
  );
}
