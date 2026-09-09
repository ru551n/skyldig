/**
 * Hard cap on any amount_minor value, kept within Postgres int8 range with
 * headroom. Lives in its own module (rather than `money.ts`) so both
 * `money.ts` and `currency/rate.ts` can import it without either module
 * importing the other.
 */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000_000n;
