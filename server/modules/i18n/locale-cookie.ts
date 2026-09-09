import { isLocale, type Locale } from "~/i18n/index.ts";

/**
 * Separate, non-sensitive cookie for the interface language (see docs/todo.md "Add English as
 * a second language"). Deliberately its own tiny helper rather than reusing
 * `server/modules/auth/cookie.ts`'s session-token machinery: this cookie carries no secret,
 * needs no `HttpOnly`/`__Host-` treatment, and must work before anyone has joined a group.
 */
export const LANG_COOKIE_NAME = "skyldig_lang";

const MAX_AGE_SECONDS = 365 * 24 * 60 * 60; // ~1 year

/** Builds the `Set-Cookie` header value that persists an explicit language choice. */
export function buildLangCookie(locale: Locale, cookieSecure: boolean): string {
  const attrs = [`${LANG_COOKIE_NAME}=${locale}`, "SameSite=Lax", "Path=/", `Max-Age=${MAX_AGE_SECONDS}`];
  if (cookieSecure) attrs.push("Secure");
  return attrs.join("; ");
}

/** Tiny cookie-header parser mirroring `auth/cookie.ts`'s `readSessionToken`: just enough for one cookie. */
export function readLangCookie(cookieHeader: string | null | undefined): Locale | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== LANG_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    return isLocale(value) ? value : null;
  }
  return null;
}

/**
 * Picks a `Locale` from an `Accept-Language` header's most-preferred tag (by `q` weight),
 * defaulting to Swedish whenever the header is absent or doesn't indicate English.
 */
export function resolveLocaleFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return "sv";
  const entries = header
    .split(",")
    .map((part) => {
      const [tagRaw, qRaw] = part.trim().split(";q=");
      const tag = tagRaw?.trim().toLowerCase() ?? "";
      const q = qRaw ? Number.parseFloat(qRaw) : 1;
      return { tag, q: Number.isFinite(q) ? q : 1 };
    })
    .filter((entry) => entry.tag.length > 0);
  entries.sort((a, b) => b.q - a.q);
  return entries[0]?.tag.startsWith("en") ? "en" : "sv";
}

/**
 * Resolves the active locale for a request: an explicit `skyldig_lang` cookie wins (the user's
 * override via the switcher), otherwise `Accept-Language`, otherwise Swedish. Works before
 * anyone has joined a group since it depends on neither the session cookie nor the database.
 */
export function resolveLocale(
  cookieHeader: string | null | undefined,
  acceptLanguageHeader: string | null | undefined,
): Locale {
  return readLangCookie(cookieHeader) ?? resolveLocaleFromAcceptLanguage(acceptLanguageHeader);
}
