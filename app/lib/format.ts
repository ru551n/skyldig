/** Formats an expiry date/timestamp as Swedish short form, e.g. "8 dec". */
export function formatExpiryShort(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" }).format(date);
}

/** Formats an expiry date/timestamp with a full year, e.g. "8 december 2026". */
export function formatExpiryLong(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric" }).format(date);
}
