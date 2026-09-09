import { useCallback, useContext } from "react";

import { sv } from "./sv.ts";
import { en } from "./en.ts";
import { LocaleContext } from "./LocaleContext.ts";

/** The two interface languages Skyldig supports. See docs/todo.md "Add English as a second language". */
export type Locale = "sv" | "en";

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "sv" || value === "en";
}

/** Maps a `Locale` to the BCP 47 tag used for `Intl` date/currency formatting. */
export function toIntlLocale(locale: Locale): string {
  return locale === "en" ? "en-GB" : "sv-SE";
}

const catalogs = { sv, en } satisfies Record<Locale, typeof sv>;

type Catalog = typeof sv;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic message-function shape
type MessageFn = (params: any) => string;

/** Every dot-path key in the catalog that resolves to a string or a message function. */
type DotPaths<T, Prefix extends string = ""> = T extends string | MessageFn
  ? Prefix extends `${infer P}`
    ? P
    : never
  : T extends object
    ? {
        [K in keyof T & string]: DotPaths<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>;
      }[keyof T & string]
    : never;

export type MessageKey = DotPaths<Catalog>;

type ParamsOf<K extends MessageKey> = ResolveValue<K> extends (params: infer P) => string ? P : never;

type ResolveValue<K extends string> = K extends `${infer Head}.${infer Rest}`
  ? Head extends keyof Catalog
    ? ResolveValueIn<Catalog[Head], Rest>
    : never
  : K extends keyof Catalog
    ? Catalog[K]
    : never;

type ResolveValueIn<T, K extends string> = K extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? ResolveValueIn<T[Head], Rest>
    : never
  : K extends keyof T
    ? T[K]
    : never;

function resolve(locale: Locale, key: string): string | MessageFn {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- traversing an untyped path at runtime
  let value: any = catalogs[locale];
  for (const part of parts) {
    value = value?.[part];
  }
  if (value === undefined) {
    throw new Error(`Missing i18n key: ${key} (locale=${locale})`);
  }
  return value as string | MessageFn;
}

/**
 * Resolves a dot-path catalog key for a given locale, e.g. `t('sv', 'dashboard.title')` or
 * `t('en', 'participants.count', { n: 3 })` for message functions. Components should use
 * `useT()` instead, which binds the active locale from context automatically.
 */
export function t<K extends MessageKey>(
  locale: Locale,
  key: K,
  ...args: ParamsOf<K> extends never ? [] : [ParamsOf<K>]
): string {
  const entry = resolve(locale, key);
  if (typeof entry === "function") {
    return entry(args[0]);
  }
  return entry;
}

/** The active interface locale, from the `LocaleContext` provided in `app/root.tsx`. */
export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** Returns a `t(key, params?)` function bound to the active locale. */
export function useT() {
  const locale = useLocale();
  return useCallback(
    <K extends MessageKey>(key: K, ...args: ParamsOf<K> extends never ? [] : [ParamsOf<K>]): string =>
      t(locale, key, ...args),
    [locale],
  );
}
