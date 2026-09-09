import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { addParticipant } from "../../server/modules/participants/participants.ts";
import { createExpense } from "../../server/modules/expenses/expenses.ts";
import { expenseParticipants, participants, sessions } from "../../server/db/schema.ts";
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

describe("an expense whose base value is exactly 1 minor unit, split across more than one participant", () => {
  it("stores shares [1, 0, 0, ...] by position, summing to 1, with zero shares accepted", async () => {
    const session = await createSession("SEK");
    const johan = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    const anna = await db.transaction((tx) => addParticipant(tx, session.id, "Anna"));
    const peter = await db.transaction((tx) => addParticipant(tx, session.id, "Peter"));

    // "0.01" SEK -> amount_minor = 1, the smallest possible non-zero expense.
    const expense = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Rounding fixture",
        amountText: "0,01",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId, peter.publicId],
        expenseDate: "2026-04-01",
      }),
    );

    expect(expense.amountMinor).toBe(1n);
    expect(expense.baseAmountMinor).toBe(1n);

    const shares = new Map(expense.participants.map((p) => [p.publicId, p.shareBaseMinor]));
    expect(shares.get(johan.publicId)).toBe(1n);
    expect(shares.get(anna.publicId)).toBe(0n);
    expect(shares.get(peter.publicId)).toBe(0n);
    expect([...shares.values()].reduce((a, b) => a + b, 0n)).toBe(1n);

    // The zero-share rows are actually persisted (not dropped), and the
    // `share_base_minor >= 0` check constraint accepts a zero share.
    const dbRows = await db
      .select({ publicId: participants.publicId, shareBaseMinor: expenseParticipants.shareBaseMinor })
      .from(expenseParticipants)
      .innerJoin(participants, eq(expenseParticipants.participantId, participants.id))
      .where(eq(expenseParticipants.expenseId, BigInt(1)));
    expect(dbRows).toHaveLength(3);
    const dbShareByPublicId = new Map(dbRows.map((r) => [r.publicId, r.shareBaseMinor]));
    expect(dbShareByPublicId.get(anna.publicId)).toBe(0n);
    expect(dbShareByPublicId.get(peter.publicId)).toBe(0n);
  });
});
