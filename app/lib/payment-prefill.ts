import { getCurrencyDecimals } from "@domain/currency/registry.ts";
import { formatMinorAsDecimal } from "@domain/money/money.ts";

/**
 * Absolute URL of a group's payment form, prefilled for one settle-up transfer. Absolute on
 * purpose: a relative `betalningar/ny` resolved against /s/:sid/gor-upp to a page that doesn't
 * exist.
 */
export function paymentPrefillUrl(
  sessionPublicId: string,
  from: string,
  to: string,
  amountMinor: string,
  currency: string,
): string {
  const amount = formatMinorAsDecimal(BigInt(amountMinor), getCurrencyDecimals(currency));
  const params = new URLSearchParams({ from, to, amount, currency });
  return `/s/${sessionPublicId}/betalningar/ny?${params.toString()}`;
}
