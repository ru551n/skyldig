/**
 * Formats an expiry date/timestamp in short form, e.g. "8 dec" (`sv-SE`) or "8 Sep" (`en-GB`).
 * `locale` should be an Intl BCP 47 tag — see `toIntlLocale` in `~/i18n` for mapping the active
 * interface `Locale` to one. Defaults to `sv-SE` for callers that don't have a locale on hand.
 */
export function formatExpiryShort(value: Date | string, locale = "sv-SE"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
}

/**
 * Formats an expiry date/timestamp with a full year, e.g. "8 december 2026" (`sv-SE`) or
 * "8 September 2026" (`en-GB`). See `formatExpiryShort` for the `locale` parameter.
 */
export function formatExpiryLong(value: Date | string, locale = "sv-SE"): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(date);
}
