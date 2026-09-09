import {
  describeRate,
  diffField,
  money,
  type ChangeLine,
} from "~/components/expense/historyDiff.ts";
import { formatExpiryLong } from "~/lib/format.ts";
import { useT } from "~/i18n";

export interface PaymentSnapshot {
  publicId: string;
  amountMinor: string;
  currencyCode: string;
  rateText: string | null;
  rateDirection: string | null;
  baseAmountMinor: string;
  paymentDate: string;
  note: string | null;
  payer: { publicId: string; displayName: string };
  recipient: { publicId: string; displayName: string };
}

export interface RevisionEntry {
  revisionNo: number;
  action: "created" | "updated" | "deleted";
  snapshot: unknown;
  createdAt: Date | string;
}

function fieldChanges(
  prev: PaymentSnapshot | undefined,
  cur: PaymentSnapshot,
  labels: {
    amount: string;
    currency: string;
    rate: string;
    payer: string;
    recipient: string;
    date: string;
    note: string;
  },
): ChangeLine[] {
  const changes: ChangeLine[] = [];
  const push = (c: ChangeLine | null) => {
    if (c) changes.push(c);
  };
  push(
    diffField(
      labels.amount,
      prev ? money(prev.amountMinor, prev.currencyCode) : "",
      money(cur.amountMinor, cur.currencyCode),
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
  push(diffField(labels.recipient, prev?.recipient.displayName ?? "", cur.recipient.displayName));
  push(diffField(labels.date, prev?.paymentDate ?? "", cur.paymentDate));
  push(diffField(labels.note, prev?.note ?? "", cur.note ?? ""));
  return changes;
}

export interface RevisionHistoryProps {
  revisions: RevisionEntry[];
}

/** Chronological revision history with a field-level diff per entry, for the payment detail page. */
export function RevisionHistory({ revisions }: RevisionHistoryProps) {
  const t = useT();

  if (revisions.length === 0) {
    return <p className="text-body text-pine-soft">{t("payment.historyEmpty")}</p>;
  }

  const labels = {
    amount: t("expense.fieldAmount"),
    currency: t("expense.fieldCurrency"),
    rate: t("expense.fieldRate"),
    payer: t("payment.fieldPayer"),
    recipient: t("payment.fieldRecipient"),
    date: t("expense.fieldDate"),
    note: t("expense.fieldNote"),
  };

  return (
    <ol className="flex flex-col gap-3">
      {revisions.map((rev, i) => {
        const cur = rev.snapshot as PaymentSnapshot;
        const prev = i > 0 ? (revisions[i - 1]!.snapshot as PaymentSnapshot) : undefined;
        const changes = rev.action === "updated" ? fieldChanges(prev, cur, labels) : [];
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
              <span className="text-meta text-pine-soft">{formatExpiryLong(rev.createdAt)}</span>
            </div>
            {changes.length > 0 && (
              <ul className="text-meta text-pine-soft mt-2 flex flex-col gap-1">
                {changes.map((c, idx) => (
                  <li key={idx}>
                    {c.label}: {c.from || "–"} → {c.to || "–"}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
