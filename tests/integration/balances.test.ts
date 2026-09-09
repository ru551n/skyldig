import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { addParticipant, deleteParticipant, renameParticipant } from "../../server/modules/participants/participants.ts";
import { createExpense, deleteExpense, updateExpense } from "../../server/modules/expenses/expenses.ts";
import { createPayment } from "../../server/modules/payments/payments.ts";
import { getSessionBalances } from "../../server/modules/balances/balances.ts";
import { getExpense } from "../../server/modules/expenses/expenses.ts";
import { sessions } from "../../server/db/schema.ts";
import { db, resetDb } from "./db.ts";

beforeEach(async () => {
  await resetDb();
});

async function createSession() {
  const [session] = await db
    .insert(sessions)
    .values({
      publicId: `pub-${randomBytes(6).toString("hex")}`,
      name: "Test session",
      baseCurrency: "SEK",
      accessKeyIndex: randomBytes(16),
      accessKeyVerifier: "verifier",
      adminKeyHash: randomBytes(16),
      pepperVersion: 1,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  return { id: session.id, baseCurrency: session.baseCurrency, publicId: session.publicId };
}

describe("balances module", () => {
  it("computes the brief's scenario: hotel split 3 ways plus a repayment", async () => {
    const session = await createSession();
    const johan = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    const anna = await db.transaction((tx) => addParticipant(tx, session.id, "Anna"));
    const peter = await db.transaction((tx) => addParticipant(tx, session.id, "Peter"));

    // Johan pays 1200 SEK hotel, split equally among Johan/Anna/Peter (400 each).
    await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Hotel",
        amountText: "1200",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId, peter.publicId],
        expenseDate: "2026-01-01",
      }),
    );

    // Anna pays Johan back 500 SEK.
    await db.transaction((tx) =>
      createPayment(tx, session, {
        amountText: "500",
        currencyCode: "SEK",
        payerPublicId: anna.publicId,
        recipientPublicId: johan.publicId,
        paymentDate: "2026-01-02",
      }),
    );

    const result = await getSessionBalances(db, session);
    const byId = new Map(result.balances.map((b) => [b.publicId, b]));

    // Johan: paid 1200, share 400, received 500 -> net = 1200 - 400 - 500 = 300.
    expect(byId.get(johan.publicId)!.net).toBe(30000n);
    // Anna: share 400, repaid 500 -> net = -400 + 500 = 100.
    expect(byId.get(anna.publicId)!.net).toBe(10000n);
    // Peter: share 400, nothing else -> net = -400.
    expect(byId.get(peter.publicId)!.net).toBe(-40000n);

    const sumNet = result.balances.reduce((acc, b) => acc + b.net, 0n);
    expect(sumNet).toBe(0n);

    // Debtor: Peter (-400). Creditors: Johan (+300), Anna (+100), sorted by
    // amount desc then position asc for the greedy pass (no exact match
    // exists first, since |Peter|=400 doesn't equal 300 or 100).
    // Greedy: largest debtor (Peter, 400) vs largest creditor (Johan, 300)
    // -> transfer 300 Peter->Johan, Peter left with 100, Johan done.
    // Then Peter (100) vs Anna (100) -> exact remaining transfer 100 Peter->Anna.
    expect(result.transfers).toEqual([
      { from: { publicId: peter.publicId, displayName: "Peter" }, to: { publicId: johan.publicId, displayName: "Johan" }, amountMinor: 30000n },
      { from: { publicId: peter.publicId, displayName: "Peter" }, to: { publicId: anna.publicId, displayName: "Anna" }, amountMinor: 10000n },
    ]);

    const transferSum = new Map<string, bigint>();
    for (const t of result.transfers) {
      transferSum.set(t.from.publicId, (transferSum.get(t.from.publicId) ?? 0n) - t.amountMinor);
      transferSum.set(t.to.publicId, (transferSum.get(t.to.publicId) ?? 0n) + t.amountMinor);
    }
    for (const b of result.balances) {
      expect(transferSum.get(b.publicId) ?? 0n).toBe(b.net);
    }
  });

  it("keeps sum(net) == 0 after a random sequence of creates/updates/deletes", async () => {
    const session = await createSession();
    const names = ["Johan", "Anna", "Peter", "Lisa", "Erik"];
    const people = [] as { publicId: string; revision: number }[];
    for (const name of names) {
      const p = await db.transaction((tx) => addParticipant(tx, session.id, name));
      people.push({ publicId: p.publicId, revision: p.revision });
    }

    let seed = 42;
    function rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    function pick<T>(arr: T[]): T {
      return arr[Math.floor(rand() * arr.length)]!;
    }

    const liveExpenses: string[] = [];

    for (let i = 0; i < 25; i++) {
      const roll = rand();
      if (roll < 0.55 || liveExpenses.length === 0) {
        const payer = pick(people);
        const n = 1 + Math.floor(rand() * people.length);
        const participantIds = [...new Set(Array.from({ length: n }, () => pick(people).publicId))];
        const amount = String(1 + Math.floor(rand() * 10000));
        const expense = await db.transaction((tx) =>
          createExpense(tx, session, {
            description: `Expense ${i}`,
            amountText: amount,
            currencyCode: "SEK",
            payerPublicId: payer.publicId,
            participantPublicIds: participantIds,
            expenseDate: "2026-01-01",
          }),
        );
        liveExpenses.push(expense.publicId);
      } else if (roll < 0.8) {
        const payer = pick(people);
        let recipient = pick(people);
        while (recipient.publicId === payer.publicId) recipient = pick(people);
        const amount = String(1 + Math.floor(rand() * 5000));
        await db.transaction((tx) =>
          createPayment(tx, session, {
            amountText: amount,
            currencyCode: "SEK",
            payerPublicId: payer.publicId,
            recipientPublicId: recipient.publicId,
            paymentDate: "2026-01-01",
          }),
        );
      } else {
        const publicId = pick(liveExpenses);
        const existing = await getExpense(db, session.id, publicId);
        await db.transaction((tx) => deleteExpense(tx, session, publicId, existing.revision));
        liveExpenses.splice(liveExpenses.indexOf(publicId), 1);
      }

      const result = await getSessionBalances(db, session);
      const sum = result.balances.reduce((acc, b) => acc + b.net, 0n);
      expect(sum).toBe(0n);
    }
  });

  it("balances stay consistent after renaming and after deleting an unreferenced participant", async () => {
    const session = await createSession();
    const johan = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    const anna = await db.transaction((tx) => addParticipant(tx, session.id, "Anna"));
    const unused = await db.transaction((tx) => addParticipant(tx, session.id, "Unused"));

    await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Lunch",
        amountText: "200",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );

    await db.transaction((tx) => renameParticipant(tx, session.id, johan.publicId, "Johan A", johan.revision));
    await db.transaction((tx) => deleteParticipant(tx, session.id, unused.publicId, unused.revision));

    const result = await getSessionBalances(db, session);
    expect(result.balances.find((b) => b.publicId === johan.publicId)?.displayName).toBe("Johan A");
    const sum = result.balances.reduce((acc, b) => acc + b.net, 0n);
    expect(sum).toBe(0n);
  });

  it("re-derives balances correctly after an expense update changes the amount and split", async () => {
    const session = await createSession();
    const johan = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    const anna = await db.transaction((tx) => addParticipant(tx, session.id, "Anna"));

    const created = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Lunch",
        amountText: "200",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );

    await db.transaction((tx) =>
      updateExpense(
        tx,
        session,
        created.publicId,
        {
          description: "Lunch",
          amountText: "300",
          currencyCode: "SEK",
          payerPublicId: johan.publicId,
          participantPublicIds: [johan.publicId, anna.publicId],
          expenseDate: "2026-01-01",
        },
        created.revision,
      ),
    );

    const result = await getSessionBalances(db, session);
    const byId = new Map(result.balances.map((b) => [b.publicId, b]));
    expect(byId.get(johan.publicId)!.net).toBe(15000n);
    expect(byId.get(anna.publicId)!.net).toBe(-15000n);
  });
});
