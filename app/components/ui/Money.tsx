import { formatMoney } from "@domain/money/money.ts";

import { cn } from "./cn.ts";

export interface MoneyProps {
  amountMinor: bigint | string;
  currency: string;
  /** When true, colors the amount moss (positive) or rust (negative). */
  signed?: boolean;
  size?: "body" | "lead" | "hero";
  className?: string;
}

const sizeClass: Record<NonNullable<MoneyProps["size"]>, string> = {
  body: "text-body font-semibold",
  lead: "text-lead font-semibold",
  hero: "text-money-hero font-semibold",
};

/** Formats a minor-unit amount with `formatMoney` (sv-SE, tabular numerals). */
export function Money({ amountMinor, currency, signed = false, size = "body", className }: MoneyProps) {
  const minor = typeof amountMinor === "string" ? BigInt(amountMinor) : amountMinor;
  const formatted = formatMoney(minor, currency, "sv-SE");
  const colorClass = signed ? (minor < 0n ? "text-rust" : "text-moss") : undefined;

  return <span className={cn("tabular", sizeClass[size], colorClass, className)}>{formatted}</span>;
}
