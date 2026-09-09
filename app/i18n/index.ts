import { sv } from "./sv.ts";

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

function resolve(key: string): string | MessageFn {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- traversing an untyped path at runtime
  let value: any = sv;
  for (const part of parts) {
    value = value?.[part];
  }
  if (value === undefined) {
    throw new Error(`Missing i18n key: ${key}`);
  }
  return value as string | MessageFn;
}

/**
 * Resolves a dot-path catalog key, e.g. `t('dashboard.title')` or
 * `t('participants.count', { n: 3 })` for message functions.
 */
export function t<K extends MessageKey>(key: K, ...args: ParamsOf<K> extends never ? [] : [ParamsOf<K>]): string {
  const entry = resolve(key);
  if (typeof entry === "function") {
    return entry(args[0]);
  }
  return entry;
}

export function useT() {
  return t;
}
