/**
 * Domain-level error codes used throughout the pure financial domain layer.
 * Every thrown domain error is a `DomainError` carrying a stable machine-readable
 * `code` so callers (server, UI) can branch on it without parsing messages.
 */
export type DomainErrorCode =
  | "UNKNOWN_CURRENCY"
  | "INVALID_AMOUNT"
  | "TOO_MANY_DECIMALS"
  | "AMOUNT_TOO_LARGE"
  | "AMOUNT_TOO_SMALL_IN_BASE"
  | "INVALID_RATE"
  | "EMPTY_SPLIT"
  | "UNBALANCED"
  | "SELF_TRANSFER"
  | "DUPLICATE_PARTICIPANT"
  | "EXPENSE_SHARES_MISMATCH";

/** Error thrown by the domain layer for any validation or invariant failure. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}
