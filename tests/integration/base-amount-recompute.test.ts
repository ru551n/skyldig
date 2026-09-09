import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { addParticipant } from "../../server/modules/participants/participants.ts";
import { createExpense } from "../../server/modules/expenses/expenses.ts";
import { createPayment } from "../../server/modules/payments/payments.ts";
import { getCurrencyDecimals } from "../../domain/currency/registry.ts";
import { expenses, payments, sessions } from "../../server/db/schema.ts";
import { db, resetDb } from "./db.ts";

beforeEach(async () => {
  await resetDb();
});

async function createSession(baseCurrency = "SEK") {
  const [session] = await db
    .insert(sessions)
    .values({
      publicId: `pub-${randomBytes(6).toString("hex")}`,
      name: "Test session",
      baseCurrency,
      accessKeyIndex: randomBytes(16),
      accessKeyVerifier: "verifier",
      adminKeyHash: randomBytes(16),
      pepperVersion: 1,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  return { id: session.id, baseCurrency: session.baseCurrency, publicId: session.publicId };
}

/**
 * docs/architecture.md sections 5-6 invariant: for every stored expense/payment with a rate,
 * `base_amount_minor` must equal the exact rational rounding
 * `(2*amount_minor*10^baseDec*rate_num + den) div (2*den)`, where
 * `den = 10^txDec*rate_den`. Same-currency rows (rate_num/rate_den null) must have
 * `base_amount_minor === amount_minor` exactly.
 */
function expectedBaseAmountMinor(
  amountMinor: bigint,
  baseDecimals: number,
  txDecimals: number,
  rateNum: bigint,
  rateDen: bigint,
): bigint {
  const num = amountMinor * 10n ** BigInt(baseDecimals) * rateNum;
  const den = 10n ** BigInt(txDecimals) * rateDen;
  return (2n * num + den) / (2n * den);
}

describe("base_amount_minor recomputation, database-wide, after a mixed-currency scenario", () => {
  it("recomputing the rounding formula reproduces base_amount_minor exactly for every stored row", async () => {
    const session = await createSession("SEK");
    const johan = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    const anna = await db.transaction((tx) => addParticipant(tx, session.id, "Anna"));

    // A mix of currencies, decimals, and directions.
    await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Hotel",
        amountText: "50",
        currencyCode: "EUR",
        rateText: "11,4523",
        rateDirection: "base_per_unit",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-03-01",
      }),
    );
    await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Ramen",
        amountText: "12345",
        currencyCode: "JPY",
        rateText: "0,0673",
        rateDirection: "base_per_unit",
        payerPublicId: anna.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-03-02",
      }),
    );
    await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Cash exchange",
        amountText: "150",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-03-03",
      }),
    );
    await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Fuel",
        amountText: "5,321",
        currencyCode: "KWD",
        rateText: "40,1",
        rateDirection: "units_per_base",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-03-04",
      }),
    );
    await db.transaction((tx) =>
      createPayment(tx, session, {
        amountText: "20",
        currencyCode: "EUR",
        rateText: "11,60",
        rateDirection: "base_per_unit",
        payerPublicId: anna.publicId,
        recipientPublicId: johan.publicId,
        paymentDate: "2026-03-05",
      }),
    );
    await db.transaction((tx) =>
      createPayment(tx, session, {
        amountText: "300",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        recipientPublicId: anna.publicId,
        paymentDate: "2026-03-06",
      }),
    );

    const baseDecimals = getCurrencyDecimals(session.baseCurrency);

    const expenseRows = await db
      .select({
        publicId: expenses.publicId,
        amountMinor: expenses.amountMinor,
        currencyCode: expenses.currencyCode,
        rateNum: expenses.rateNum,
        rateDen: expenses.rateDen,
        baseAmountMinor: expenses.baseAmountMinor,
      })
      .from(expenses)
      .where(eq(expenses.sessionId, session.id));
    const paymentRows = await db
      .select({
        publicId: payments.publicId,
        amountMinor: payments.amountMinor,
        currencyCode: payments.currencyCode,
        rateNum: payments.rateNum,
        rateDen: payments.rateDen,
        baseAmountMinor: payments.baseAmountMinor,
      })
      .from(payments)
      .where(eq(payments.sessionId, session.id));

    expect(expenseRows.length).toBe(4);
    expect(paymentRows.length).toBe(2);

    for (const row of [...expenseRows, ...paymentRows]) {
      if (row.rateNum === null || row.rateDen === null) {
        expect(row.baseAmountMinor, `${row.publicId}: same-currency row must equal amount_minor exactly`).toBe(
          row.amountMinor,
        );
        continue;
      }
      const txDecimals = getCurrencyDecimals(row.currencyCode);
      const expected = expectedBaseAmountMinor(row.amountMinor, baseDecimals, txDecimals, row.rateNum, row.rateDen);
      expect(row.baseAmountMinor, `${row.publicId}: base_amount_minor mismatch`).toBe(expected);
    }
  });
});
