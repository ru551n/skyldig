import { getCurrencyDecimals, type CurrencyCode } from "./registry.ts";
import { DomainError } from "../errors.ts";
import { MAX_AMOUNT_MINOR } from "../money/constants.ts";
import type { Money } from "../money/money.ts";

/**
 * How a rate's text was entered:
 * - `base_per_unit`: "1 unit of the transaction currency = X units of base",
 *   e.g. "1 EUR = 11.45 SEK" typed as "11.45".
 * - `units_per_base`: "1 unit of base = X units of the transaction currency",
 *   e.g. "1 SEK = 150 JPY" typed as "150".
 */
export type RateDirection = "base_per_unit" | "units_per_base";

/**
 * An exchange rate stored as an exact rational. `num`/`den` always mean:
 * "1 unit of the transaction currency = num/den units of base currency",
 * regardless of which direction the user typed it in.
 */
export interface ExchangeRate {
  num: bigint;
  den: bigint;
  direction: RateDirection;
  text: string;
}

const MAX_RATE_COMPONENT = 1_000_000_000_000_000n; // 10^15
const RATE_RE = /^([0-9]+)(?:[.,]([0-9]{1,12}))?$/;

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

/**
 * Parses a positive decimal rate string (`,` or `.` as decimal separator,
 * up to 12 decimal places, no thousands separators) typed in `direction`
 * into an exact rational `num/den` meaning "1 unit of the transaction
 * currency = num/den units of base". `units_per_base` text is inverted
 * (e.g. "150" -> num=1, den=150); `base_per_unit` text is used directly
 * (e.g. "0.0000734" -> num=734, den=10000000). The fraction is always
 * reduced by its gcd.
 *
 * Throws `INVALID_RATE` for zero, negative, malformed input, or a reduced
 * numerator/denominator exceeding 10^15.
 */
export function parseRate(text: string, direction: RateDirection): ExchangeRate {
  const trimmed = text.trim();
  const match = RATE_RE.exec(trimmed);
  if (!match) {
    throw new DomainError("INVALID_RATE", `Invalid rate: ${text}`);
  }
  const intPart = match[1]!;
  const fracPart = match[2] ?? "";

  const rawNum = BigInt(intPart + fracPart);
  const rawDen = 10n ** BigInt(fracPart.length);

  if (rawNum === 0n) {
    throw new DomainError("INVALID_RATE", `Rate must be positive: ${text}`);
  }

  const g = gcd(rawNum, rawDen);
  const reducedNum = rawNum / g;
  const reducedDen = rawDen / g;

  const [num, den] = direction === "units_per_base" ? [reducedDen, reducedNum] : [reducedNum, reducedDen];

  if (num > MAX_RATE_COMPONENT || den > MAX_RATE_COMPONENT) {
    throw new DomainError("INVALID_RATE", `Rate out of range: ${text}`);
  }

  return { num, den, direction, text };
}

/**
 * Converts a transaction-currency amount into base-currency minor units.
 *
 * If `currency === baseCurrency`, `rate` is ignored (not required) and the
 * amount is returned unchanged. Otherwise `rate` is required and the
 * conversion is:
 * `num = amountMinor * 10^baseDecimals * rate.num`,
 * `den = 10^txDecimals * rate.den`,
 * `result = floor((2*num + den) / (2*den))` — i.e. round half away from
 * zero, valid because all inputs are positive.
 *
 * Throws `INVALID_AMOUNT` if `money.amountMinor` is not positive,
 * `AMOUNT_TOO_SMALL_IN_BASE` if the result rounds to 0,
 * `AMOUNT_TOO_LARGE` if the result exceeds `MAX_AMOUNT_MINOR`, and
 * `INVALID_RATE` if a conversion between different currencies is attempted
 * without a rate.
 */
export function convertToBase(money: Money, baseCurrency: CurrencyCode, rate?: ExchangeRate): bigint {
  if (money.amountMinor <= 0n) {
    throw new DomainError("INVALID_AMOUNT", "Amount to convert must be positive");
  }
  if (money.currency === baseCurrency) {
    return money.amountMinor;
  }
  if (!rate) {
    throw new DomainError("INVALID_RATE", "A rate is required to convert between different currencies");
  }

  const baseDecimals = getCurrencyDecimals(baseCurrency);
  const txDecimals = getCurrencyDecimals(money.currency);

  const num = money.amountMinor * 10n ** BigInt(baseDecimals) * rate.num;
  const den = 10n ** BigInt(txDecimals) * rate.den;

  const result = (2n * num + den) / (2n * den);

  if (result === 0n) {
    throw new DomainError("AMOUNT_TOO_SMALL_IN_BASE", "Converted amount rounds to zero in the base currency");
  }
  if (result > MAX_AMOUNT_MINOR) {
    throw new DomainError("AMOUNT_TOO_LARGE", `Converted amount exceeds maximum of ${MAX_AMOUNT_MINOR}`);
  }
  return result;
}
