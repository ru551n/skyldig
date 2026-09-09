import { formatMoney } from "@domain/money/money.ts";

export interface ChangeLine {
  label: string;
  from: string;
  to: string;
}

/** Renders a rate as "1 EUR = 11,45 SEK" / "1 SEK = 150 JPY" in words, or "" when there is none. */
export function describeRate(
  rateText: string | null,
  rateDirection: string | null,
  currencyCode: string,
  baseCurrencyCode: string,
): string {
  if (!rateText || !rateDirection) return "";
  return rateDirection === "base_per_unit"
    ? `1 ${currencyCode} = ${rateText} ${baseCurrencyCode}`
    : `1 ${baseCurrencyCode} = ${rateText} ${currencyCode}`;
}

/** Compares two scalar field values (already stringified for display) and returns a ChangeLine if they differ. */
export function diffField(label: string, from: string, to: string): ChangeLine | null {
  return from === to ? null : { label, from, to };
}

export function money(amountMinor: string, currencyCode: string): string {
  try {
    return formatMoney(BigInt(amountMinor), currencyCode);
  } catch {
    return `${amountMinor} ${currencyCode}`;
  }
}

/** Diffs two participant sets (publicId -> displayName) into added/removed name lists. */
export function diffParticipantSet(
  before: { publicId: string; displayName: string }[] | undefined,
  after: { publicId: string; displayName: string }[],
): { added: string[]; removed: string[] } {
  const beforeIds = new Set((before ?? []).map((p) => p.publicId));
  const afterIds = new Set(after.map((p) => p.publicId));
  const added = after.filter((p) => !beforeIds.has(p.publicId)).map((p) => p.displayName);
  const removed = (before ?? []).filter((p) => !afterIds.has(p.publicId)).map((p) => p.displayName);
  return { added, removed };
}
