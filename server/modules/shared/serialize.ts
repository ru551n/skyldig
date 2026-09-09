/** Serializes a `bigint` (e.g. minor-unit money) to a plain decimal string for JSON. */
export function bigintToString(value: bigint): string {
  return value.toString();
}

/** Formats a `Date` as a `YYYY-MM-DD` date-only ISO string (no time component). */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
