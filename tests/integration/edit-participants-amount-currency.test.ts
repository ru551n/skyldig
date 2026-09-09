import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { addParticipant } from "../../server/modules/participants/participants.ts";
import { createExpense, updateExpense } from "../../server/modules/expenses/expenses.ts";
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

async function fourParticipants(sessionId: bigint) {
  const johan = await db.transaction((tx) => addParticipant(tx, sessionId, "Johan"));
  const anna = await db.transaction((tx) => addParticipant(tx, sessionId, "Anna"));
  const peter = await db.transaction((tx) => addParticipant(tx, sessionId, "Peter"));
  const lisa = await db.transaction((tx) => addParticipant(tx, sessionId, "Lisa"));
  return { johan, anna, peter, lisa };
}

/** Snapshots this expense's stored shares as a `publicId -> shareBaseMinor` list, sorted by publicId for stable comparison. */
async function shareRowsFor(expenseId: bigint) {
  const rows = await db
    .select({ publicId: participants.publicId, shareBaseMinor: expenseParticipants.shareBaseMinor })
    .from(expenseParticipants)
    .innerJoin(participants, eq(expenseParticipants.participantId, participants.id))
    .where(eq(expenseParticipants.expenseId, expenseId));
  return rows
    .map((r) => ({ publicId: r.publicId, shareBaseMinor: r.shareBaseMinor.toString() }))
    .sort((a, b) => (a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0));
}

describe("editing an expense's participants, amount, and currency together (docs/architecture.md sections 5-6)", () => {
  it("applying the same combined edit back and forth yields byte-identical share_base_minor rows", async () => {
    const session = await createSession();
    const { johan, anna, peter, lisa } = await fourParticipants(session.id);

    const original = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Groceries",
        amountText: "100",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-02-01",
      }),
    );
    const expenseRow = await db.query.expenses.findFirst({ where: (e, { eq: eq2 }) => eq2(e.publicId, original.publicId) });
    const expenseId = expenseRow!.id;

    const editA = {
      description: "Groceries + drinks",
      amountText: "77,50",
      currencyCode: "EUR",
      rateText: "11,25",
      rateDirection: "base_per_unit" as const,
      payerPublicId: peter.publicId,
      participantPublicIds: [johan.publicId, anna.publicId, peter.publicId, lisa.publicId],
      expenseDate: "2026-02-01",
    };

    await db.transaction((tx) => updateExpense(tx, session, original.publicId, editA, 1));
    const afterEditA = await shareRowsFor(expenseId);

    // Apply the exact opposite edit (back to the original shape).
    const editB = {
      description: "Groceries",
      amountText: "100",
      currencyCode: "SEK",
      payerPublicId: johan.publicId,
      participantPublicIds: [johan.publicId, anna.publicId],
      expenseDate: "2026-02-01",
    };
    await db.transaction((tx) => updateExpense(tx, session, original.publicId, editB, 2));
    const afterEditB = await shareRowsFor(expenseId);
    expect(afterEditB).toEqual(
      [
        { publicId: johan.publicId, shareBaseMinor: "5000" },
        { publicId: anna.publicId, shareBaseMinor: "5000" },
      ].sort((a, b) => (a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0)),
    );

    // Applying editA again from this point must reproduce byte-identical shares.
    await db.transaction((tx) => updateExpense(tx, session, original.publicId, editA, 3));
    const afterEditAAgain = await shareRowsFor(expenseId);
    expect(afterEditAAgain).toEqual(afterEditA);
  });

  it("reversing the order of participantPublicIds does not change the stored shares", async () => {
    const session = await createSession();
    const { johan, anna, peter, lisa } = await fourParticipants(session.id);

    const original = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Trip",
        amountText: "101",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId, peter.publicId, lisa.publicId],
        expenseDate: "2026-02-02",
      }),
    );
    const expenseRow = await db.query.expenses.findFirst({ where: (e, { eq: eq2 }) => eq2(e.publicId, original.publicId) });
    const expenseId = expenseRow!.id;
    const forwardShares = await shareRowsFor(expenseId);

    const reversedInput = {
      description: "Trip",
      amountText: "101",
      currencyCode: "SEK",
      payerPublicId: johan.publicId,
      participantPublicIds: [lisa.publicId, peter.publicId, anna.publicId, johan.publicId],
      expenseDate: "2026-02-02",
    };
    await db.transaction((tx) => updateExpense(tx, session, original.publicId, reversedInput, 1));
    const reversedShares = await shareRowsFor(expenseId);

    expect(reversedShares).toEqual(forwardShares);
  });
});
