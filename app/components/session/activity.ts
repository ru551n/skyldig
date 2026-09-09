/** Shapes and helpers for rendering the activity feed (dashboard "Senaste" and /aktivitet). */

export type ActivityEntityType = "expense" | "payment";
export type ActivityAction = "created" | "updated" | "deleted";

/** Serializable activity row as returned by the loaders (createdAt as ISO string). */
export interface SerializedActivityRow {
  entityType: ActivityEntityType;
  action: ActivityAction;
  revisionNo: number;
  createdAt: string;
  snapshot: unknown;
}

interface ExpenseSnapshot {
  publicId: string;
  description: string;
  baseAmountMinor: string;
  payer: { publicId: string; displayName: string };
}

interface PaymentSnapshot {
  publicId: string;
  baseAmountMinor: string;
  payer: { publicId: string; displayName: string };
  recipient: { publicId: string; displayName: string };
}

export interface ActivityDisplayItem {
  key: string;
  entityType: ActivityEntityType;
  action: ActivityAction;
  createdAt: string;
  publicId: string;
  title: string;
  personLine: string;
  amountMinor: string;
  href: string | null;
  deleted: boolean;
}

/** Derives what to render from one raw activity row. `baseCurrency` is the session's currency. */
export function toDisplayItem(row: SerializedActivityRow, index: number): ActivityDisplayItem {
  const deleted = row.action === "deleted";

  if (row.entityType === "expense") {
    const snap = row.snapshot as ExpenseSnapshot;
    return {
      key: `expense-${snap.publicId}-${row.revisionNo}-${index}`,
      entityType: "expense",
      action: row.action,
      createdAt: row.createdAt,
      publicId: snap.publicId,
      title: snap.description,
      personLine: `${snap.payer.displayName} betalade`,
      amountMinor: snap.baseAmountMinor,
      href: deleted ? null : `utgifter/${snap.publicId}`,
      deleted,
    };
  }

  const snap = row.snapshot as PaymentSnapshot;
  return {
    key: `payment-${snap.publicId}-${row.revisionNo}-${index}`,
    entityType: "payment",
    action: row.action,
    createdAt: row.createdAt,
    publicId: snap.publicId,
    title: "Betalning",
    personLine: `${snap.payer.displayName} → ${snap.recipient.displayName}`,
    amountMinor: snap.baseAmountMinor,
    href: deleted ? null : `betalningar/${snap.publicId}`,
    deleted,
  };
}

/** Swedish day heading: "Idag", "Igår", or "3 december". */
export function formatDayHeading(date: Date, now: Date = new Date()): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Idag";
  if (diffDays === 1) return "Igår";
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long" }).format(date);
}

/** Groups display items by calendar day, preserving newest-first order. */
export function groupByDay(items: ActivityDisplayItem[]): { heading: string; items: ActivityDisplayItem[] }[] {
  const groups: { heading: string; items: ActivityDisplayItem[] }[] = [];
  let currentKey = "";
  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (key !== currentKey) {
      groups.push({ heading: formatDayHeading(date), items: [] });
      currentKey = key;
    }
    groups[groups.length - 1]!.items.push(item);
  }
  return groups;
}

/** Formats a time as "14:32" (sv-SE, 24h). */
export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
