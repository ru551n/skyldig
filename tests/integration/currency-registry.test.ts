import { describe, expect, it } from "vitest";

import { getCurrencyDecimals, listCurrencies } from "../../domain/currency/registry.ts";
import { currencies } from "../../server/db/schema.ts";
import { db } from "./db.ts";

/**
 * The TypeScript currency registry (`domain/currency/registry.ts`) and the
 * `currencies` table are two independently maintained sources of truth for
 * currency codes and their minor-unit decimals. `parseAmount`/`convertToBase`
 * read from the TS map while `validateBaseCurrency` and the foreign keys read
 * from the table; a drift between them would silently mis-scale money. This
 * test asserts they agree.
 */
describe("currency registry vs currencies table", () => {
  it("has exactly the same set of currency codes", async () => {
    const dbRows = await db.select({ code: currencies.code }).from(currencies);
    const dbCodes = new Set(dbRows.map((r) => r.code));
    const registryCodes = new Set(listCurrencies().map((c) => c.code));

    const onlyInDb = [...dbCodes].filter((c) => !registryCodes.has(c)).sort();
    const onlyInRegistry = [...registryCodes].filter((c) => !dbCodes.has(c)).sort();

    expect(onlyInDb, `codes present in the currencies table but missing from the TS registry: ${onlyInDb.join(", ")}`).toEqual([]);
    expect(
      onlyInRegistry,
      `codes present in the TS registry but missing from the currencies table: ${onlyInRegistry.join(", ")}`,
    ).toEqual([]);
  });

  it("agrees on decimals for every currency code", async () => {
    const dbRows = await db.select({ code: currencies.code, decimals: currencies.decimals }).from(currencies);

    const mismatches: string[] = [];
    for (const row of dbRows) {
      let registryDecimals: number;
      try {
        registryDecimals = getCurrencyDecimals(row.code);
      } catch {
        // Missing-from-registry codes are already reported by the code-set test above.
        continue;
      }
      if (registryDecimals !== row.decimals) {
        mismatches.push(`${row.code} (db=${row.decimals}, registry=${registryDecimals})`);
      }
    }

    expect(mismatches, `decimals mismatch for: ${mismatches.join(", ")}`).toEqual([]);
  });
});
