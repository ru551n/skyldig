import { randomBytes } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { addParticipant } from "../../server/modules/participants/participants.ts";
import { createExpense, suggestRate } from "../../server/modules/expenses/expenses.ts";
import { createPayment } from "../../server/modules/payments/payments.ts";
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
 * Regression test for `suggestRate`'s deterministic tie-break: when the
 * candidate expense and payment rows share the exact same `updated_at`
 * (which `ORDER BY updated_at DESC` alone cannot break), the secondary
 * `ORDER BY public_id DESC` must pick a stable winner rather than an
 * arbitrary one.
 */
describe("suggestRate tie-break", () => {
  it("is stable when an expense and a payment share the same updated_at", async () => {
    const session = await createSession();
    const johan = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    const anna = await db.transaction((tx) => addParticipant(tx, session.id, "Anna"));

    const expense = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Hotel",
        amountText: "50",
        currencyCode: "EUR",
        rateText: "11,45",
        rateDirection: "base_per_unit",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-02",
      }),
    );

    const payment = await db.transaction((tx) =>
      createPayment(tx, session, {
        amountText: "20",
        currencyCode: "EUR",
        rateText: "11,60",
        rateDirection: "base_per_unit",
        payerPublicId: anna.publicId,
        recipientPublicId: johan.publicId,
        paymentDate: "2026-01-03",
      }),
    );

    // Force an exact tie on updated_at so ORDER BY updated_at DESC alone is ambiguous.
    const tiedAt = new Date("2026-01-05T12:00:00Z");
    await db.update(expenses).set({ updatedAt: tiedAt }).where(eq(expenses.publicId, expense.publicId));
    await db.update(payments).set({ updatedAt: tiedAt }).where(eq(payments.publicId, payment.publicId));

    const expectedWinner = expense.publicId > payment.publicId ? "expense" : "payment";
    const expectedRateText = expectedWinner === "expense" ? "11,45" : "11,60";

    const results = await Promise.all([
      suggestRate(db, session.id, "EUR"),
      suggestRate(db, session.id, "EUR"),
      suggestRate(db, session.id, "EUR"),
    ]);

    for (const result of results) {
      expect(result).not.toBeNull();
      expect(result!.rateText).toBe(expectedRateText);
    }

    // Sanity check the underlying tie actually exists (both rows really share updated_at),
    // so this test would fail before the fix instead of vacuously passing.
    const [tiedCount] = await db
      .execute<{ n: string }>(sql`
        select count(*)::int as n from (
          select updated_at from expenses where public_id = ${expense.publicId}
          union all
          select updated_at from payments where public_id = ${payment.publicId}
        ) t where t.updated_at = ${tiedAt.toISOString()}
      `)
      .then((r) => r.rows);
    expect(Number(tiedCount!.n)).toBe(2);
  });
});
