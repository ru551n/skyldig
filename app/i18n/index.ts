import { sv } from "./sv.ts";

export type MessageKey = keyof typeof sv;

type Params = Record<string, string | number>;

export function t(key: MessageKey, params?: Params): string {
  const entry = sv[key];
  if (typeof entry === "function") {
    return (entry as (p?: Params) => string)(params);
  }
  return entry;
}

export function useT() {
  return t;
}
