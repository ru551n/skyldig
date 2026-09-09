import { formatExpiryLong } from "~/lib/format.ts";
import { toIntlLocale, useLocale, useT } from "~/i18n";

import {
  describeRate,
  diffField,
  diffParticipantSet,
  money,
  type ChangeLine,
} from "./historyDiff.ts";

export interface ExpenseSnapshot {
  publicId: string;
  description: string;
  amountMinor: string;
  currencyCode: string;
  rateText: string | null;
  rateDirection: string | null;
  baseAmountMinor: string;
  expenseDate: string;
  note: string | null;
  payer: { publicId: string; displayName: string };
  participants: { publicId: string; displayName: string; shareBaseMinor: string }[];
}

export interface RevisionEntry {
  revisionNo: number;
  action: "created" | "updated" | "deleted";
  snapshot: unknown;
  createdAt: Date | string;
}

function fieldChanges(
  prev: ExpenseSnapshot | undefined,
  cur: ExpenseSnapshot,
  labels: {
    description: string;
    amount: string;
    currency: string;
    rate: string;
    payer: string;
    date: string;
    note: string;
  },
  intlLocale: string,
): ChangeLine[] {
  const changes: ChangeLine[] = [];
  const push = (c: ChangeLine | null) => {
    if (c) changes.push(c);
  };
  push(diffField(labels.description, prev?.description ?? "", cur.description));
  push(
    diffField(
      labels.amount,
      prev ? money(prev.amountMinor, prev.currencyCode, intlLocale) : "",
      money(cur.amountMinor, cur.currencyCode, intlLocale),
    ),
  );
  push(diffField(labels.currency, prev?.currencyCode ?? "", cur.currencyCode));
  push(
    diffField(
      labels.rate,
      prev ? describeRate(prev.rateText, prev.rateDirection, prev.currencyCode, "") : "",
      describeRate(cur.rateText, cur.rateDirection, cur.currencyCode, ""),
    ),
  );
  push(diffField(labels.payer, prev?.payer.displayName ?? "", cur.payer.displayName));
  push(diffField(labels.date, prev?.expenseDate ?? "", cur.expenseDate));
  push(diffField(labels.note, prev?.note ?? "", cur.note ?? ""));
  return changes;
}

export interface RevisionHistoryProps {
  revisions: RevisionEntry[];
}

/** Chronological revision history with a field-level diff per entry, for the expense detail page. */
export function RevisionHistory({ revisions }: RevisionHistoryProps) {
  const t = useT();
  const locale = useLocale();
  const intlLocale = toIntlLocale(locale);

  if (revisions.length === 0) {
    return <p className="text-body text-pine-soft">{t("expense.historyEmpty")}</p>;
  }

  const labels = {
    description: t("expense.fieldDescription"),
    amount: t("expense.fieldAmount"),
    currency: t("expense.fieldCurrency"),
    rate: t("expense.fieldRate"),
    payer: t("expense.fieldPayer"),
    date: t("expense.fieldDate"),
    note: t("expense.fieldNote"),
  };

  return (
    <ol className="flex flex-col gap-3">
      {revisions.map((rev, i) => {
        const cur = rev.snapshot as ExpenseSnapshot;
        const prev = i > 0 ? (revisions[i - 1]!.snapshot as ExpenseSnapshot) : undefined;
        const changes = rev.action === "updated" ? fieldChanges(prev, cur, labels, intlLocale) : [];
        const { added, removed } =
          rev.action === "updated"
            ? diffParticipantSet(prev?.participants, cur.participants)
            : { added: [], removed: [] };
        const actionLabel =
          rev.action === "created"
            ? t("common.created")
            : rev.action === "deleted"
              ? t("activity.deleted")
              : t("activity.edited");

        return (
          <li key={rev.revisionNo} className="rounded-card border-line bg-paper border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-body text-pine font-medium">{actionLabel}</span>
              <span className="text-meta text-pine-soft">{formatExpiryLong(rev.createdAt, intlLocale)}</span>
            </div>
            {changes.length > 0 || added.length > 0 || removed.length > 0 ? (
              <ul className="text-meta text-pine-soft mt-2 flex flex-col gap-1">
                {changes.map((c, idx) => (
                  <li key={idx}>
                    {c.label}: {c.from || "–"} → {c.to || "–"}
                  </li>
                ))}
                {added.length > 0 && (
                  <li>
                    {t("expense.fieldParticipantsAdded")}: {added.join(", ")}
                  </li>
                )}
                {removed.length > 0 && (
                  <li>
                    {t("expense.fieldParticipantsRemoved")}: {removed.join(", ")}
                  </li>
                )}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
