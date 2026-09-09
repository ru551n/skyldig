import { describe, expect, it } from "vitest";

import { en } from "./en.ts";
import { sv } from "./sv.ts";

/** Recursively collects every dot-path key that resolves to a string or function leaf. */
function deepKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") {
    return [prefix];
  }
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "function") {
      return [path];
    }
    if (value !== null && typeof value === "object") {
      return deepKeys(value, path);
    }
    return [path];
  });
}

describe("i18n catalogs", () => {
  it("sv and en expose exactly the same set of keys", () => {
    const svKeys = deepKeys(sv).sort();
    const enKeys = deepKeys(en).sort();

    expect(enKeys).toEqual(svKeys);
  });

  it("has no empty-string values in either catalog", () => {
    for (const [name, catalog] of [
      ["sv", sv],
      ["en", en],
    ] as const) {
      for (const key of deepKeys(catalog)) {
        const parts = key.split(".");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- traversing an untyped path
        let value: any = catalog;
        for (const part of parts) value = value?.[part];
        if (typeof value === "string") {
          expect(value.length, `${name}.${key} should not be empty`).toBeGreaterThan(0);
        }
      }
    }
  });
});
