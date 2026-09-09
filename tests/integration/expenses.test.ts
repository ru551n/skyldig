import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { addParticipant } from "../../server/modules/participants/participants.ts";
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  suggestRate,
  updateExpense,
} from "../../server/modules/expenses/expenses.ts";
import { createPayment } from "../../server/modules/payments/payments.ts";
import { listActivity, listRevisionsForEntity } from "../../server/modules/audit/audit.ts";
import { ConflictError, NotFoundError, ValidationError } from "../../server/modules/shared/errors.ts";
import { convertToBase, parseAmount, parseRate, splitEqually } from "../../domain/index.ts";
import { expenseParticipants, expenses, participants, sessions } from "../../server/db/schema.ts";
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

async function threeParticipants(sessionId: bigint) {
  const johan = await db.transaction((tx) => addParticipant(tx, sessionId, "Johan"));
  const anna = await db.transaction((tx) => addParticipant(tx, sessionId, "Anna"));
  const peter = await db.transaction((tx) => addParticipant(tx, sessionId, "Peter"));
  return { johan, anna, peter };
}

describe("expenses module", () => {
  it("splits a SEK expense 100 among 3 participants as 34/33/33 by position", async () => {
    const session = await createSession();
    const { johan, anna, peter } = await threeParticipants(session.id);

    const expense = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Dinner",
        amountText: "100",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId, peter.publicId],
        expenseDate: "2026-01-01",
      }),
    );

    expect(expense.amountMinor).toBe(10000n);
    expect(expense.baseAmountMinor).toBe(10000n);
    expect(expense.revision).toBe(1);

    const shares = new Map(expense.participants.map((p) => [p.publicId, p.shareBaseMinor]));
    // 10000 minor units / 3 = 3333.33..., largest-remainder gives the first
    // participant by position (Johan) the leftover unit: 3334/3333/3333.
    expect(shares.get(johan.publicId)).toBe(3334n);
    expect(shares.get(anna.publicId)).toBe(3333n);
    expect(shares.get(peter.publicId)).toBe(3333n);
    expect(expense.participants.map((p) => p.shareBaseMinor).reduce((a, b) => a + b, 0n)).toBe(10000n);

    const dbRows = await db.select().from(expenseParticipants).where(eq(expenseParticipants.expenseId, BigInt(1)));
    expect(dbRows).toHaveLength(3);
    for (const row of dbRows) {
      expect(row.weightScaled).toBe(1_000_000n);
    }
  });

  it("converts a EUR expense to base currency using a base_per_unit rate", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id).then(({ johan, anna }) => ({ johan, anna }));

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

    // Hand-computed: 50 EUR * 11.45 = 572.50 SEK -> 57250 minor units.
    expect(expense.baseAmountMinor).toBe(57250n);

    // Cross-check with the domain functions directly.
    const amountMinor = parseAmount("50", "EUR");
    const rate = parseRate("11,45", "base_per_unit");
    const expected = convertToBase({ amountMinor, currency: "EUR" }, "SEK", rate);
    expect(expense.baseAmountMinor).toBe(expected);
  });

  it("rejects a foreign-currency expense missing a rate", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);

    await expect(
      db.transaction((tx) =>
        createExpense(tx, session, {
          description: "Hotel",
          amountText: "50",
          currencyCode: "EUR",
          payerPublicId: johan.publicId,
          participantPublicIds: [johan.publicId, anna.publicId],
          expenseDate: "2026-01-02",
        }),
      ),
    ).rejects.toMatchObject({ code: "RATE_REQUIRED", field: "rateText" });
  });

  it("updates participants and amount, re-deriving shares and bumping revision", async () => {
    const session = await createSession();
    const { johan, anna, peter } = await threeParticipants(session.id);

    const created = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Dinner",
        amountText: "100",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );

    const updated = await db.transaction((tx) =>
      updateExpense(
        tx,
        session,
        created.publicId,
        {
          description: "Dinner v2",
          amountText: "90",
          currencyCode: "SEK",
          payerPublicId: johan.publicId,
          participantPublicIds: [johan.publicId, anna.publicId, peter.publicId],
          expenseDate: "2026-01-01",
        },
        created.revision,
      ),
    );

    expect(updated.revision).toBe(2);
    expect(updated.amountMinor).toBe(9000n);
    expect(updated.participants).toHaveLength(3);
    expect(updated.participants.reduce((a, p) => a + p.shareBaseMinor, 0n)).toBe(9000n);

    const revs = await listRevisionsForEntity(db, session.id, "expense", created.publicId);
    expect(revs.map((r) => r.action)).toEqual(["created", "updated"]);
  });

  it("rejects an update with a stale revision", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);
    const created = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Dinner",
        amountText: "100",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );

    let error: unknown;
    try {
      await db.transaction((tx) =>
        updateExpense(
          tx,
          session,
          created.publicId,
          {
            description: "Dinner v2",
            amountText: "90",
            currencyCode: "SEK",
            payerPublicId: johan.publicId,
            participantPublicIds: [johan.publicId, anna.publicId],
            expenseDate: "2026-01-01",
          },
          99,
        ),
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConflictError);
  });

  it("deletes an expense, removing shares and recording a deleted snapshot", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);
    const created = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Dinner",
        amountText: "100",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );

    await db.transaction((tx) => deleteExpense(tx, session, created.publicId, created.revision));

    await expect(getExpense(db, session.id, created.publicId)).rejects.toMatchObject({ status: 404 });
    const rows = await db.select().from(expenses).where(eq(expenses.publicId, created.publicId));
    expect(rows).toHaveLength(0);
    const partRows = await db.select().from(expenseParticipants);
    expect(partRows).toHaveLength(0);

    const revs = await listRevisionsForEntity(db, session.id, "expense", created.publicId);
    expect(revs.map((r) => r.action)).toEqual(["created", "deleted"]);
    const deletedSnapshot = revs[1]!.snapshot as { participants: unknown[] };
    expect(deletedSnapshot.participants).toHaveLength(2);
  });

  it("revision_no sequence: create = 1, update = 2, delete = expected + 1", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);
    const created = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Dinner",
        amountText: "100",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );
    expect(created.revision).toBe(1);

    const updated = await db.transaction((tx) =>
      updateExpense(
        tx,
        session,
        created.publicId,
        {
          description: "Dinner v2",
          amountText: "90",
          currencyCode: "SEK",
          payerPublicId: johan.publicId,
          participantPublicIds: [johan.publicId, anna.publicId],
          expenseDate: "2026-01-01",
        },
        created.revision,
      ),
    );
    expect(updated.revision).toBe(2);

    await db.transaction((tx) => deleteExpense(tx, session, created.publicId, updated.revision));
    const revs = await listRevisionsForEntity(db, session.id, "expense", created.publicId);
    expect(revs.map((r) => ({ action: r.action, revisionNo: r.revisionNo }))).toEqual([
      { action: "created", revisionNo: 1 },
      { action: "updated", revisionNo: 2 },
      { action: "deleted", revisionNo: 3 },
    ]);
  });

  it("rejects deleteExpense with a stale revision with a ConflictError carrying current state", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);
    const created = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Dinner",
        amountText: "100",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );

    let error: unknown;
    try {
      await db.transaction((tx) => deleteExpense(tx, session, created.publicId, created.revision + 1));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).current).toMatchObject({ publicId: created.publicId, revision: created.revision });

    // The expense must still be there -- the stale delete must not have gone through.
    const stillThere = await getExpense(db, session.id, created.publicId);
    expect(stillThere.publicId).toBe(created.publicId);
  });

  it("deleteExpense on an already-deleted expense throws NotFoundError", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);
    const created = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Dinner",
        amountText: "100",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );
    await db.transaction((tx) => deleteExpense(tx, session, created.publicId, created.revision));

    await expect(
      db.transaction((tx) => deleteExpense(tx, session, created.publicId, created.revision)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("real concurrent update of one expense from two transactions yields exactly one ConflictError", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);
    const created = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Dinner",
        amountText: "100",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );

    const attempt = (amountText: string) =>
      db.transaction((tx) =>
        updateExpense(
          tx,
          session,
          created.publicId,
          {
            description: "Dinner",
            amountText,
            currencyCode: "SEK",
            payerPublicId: johan.publicId,
            participantPublicIds: [johan.publicId, anna.publicId],
            expenseDate: "2026-01-01",
          },
          created.revision,
        ),
      );

    const results = await Promise.allSettled([attempt("91"), attempt("92")]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    const finalRow = await getExpense(db, session.id, created.publicId);
    expect(finalRow.revision).toBe(2);
  });

  it("changing a foreign-currency expense to the base currency nulls the rate fields", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);
    const created = await db.transaction((tx) =>
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
    expect(created.rateText).not.toBeNull();

    const updated = await db.transaction((tx) =>
      updateExpense(
        tx,
        session,
        created.publicId,
        {
          description: "Hotel",
          amountText: "500",
          currencyCode: "SEK",
          payerPublicId: johan.publicId,
          participantPublicIds: [johan.publicId, anna.publicId],
          expenseDate: "2026-01-02",
        },
        created.revision,
      ),
    );

    expect(updated.rateText).toBeNull();
    expect(updated.rateDirection).toBeNull();
    expect(updated.amountMinor).toBe(50000n);
    expect(updated.baseAmountMinor).toBe(updated.amountMinor);

    const [row] = await db.select().from(expenses).where(eq(expenses.publicId, created.publicId));
    expect(row!.rateNum).toBeNull();
    expect(row!.rateDen).toBeNull();
  });

  it("shrinking an expense's participant set leaves no stale expense_participants rows", async () => {
    const session = await createSession();
    const { johan, anna, peter } = await threeParticipants(session.id);
    const created = await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Dinner",
        amountText: "90",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId, peter.publicId],
        expenseDate: "2026-01-01",
      }),
    );

    await db.transaction((tx) =>
      updateExpense(
        tx,
        session,
        created.publicId,
        {
          description: "Dinner",
          amountText: "50",
          currencyCode: "SEK",
          payerPublicId: johan.publicId,
          participantPublicIds: [johan.publicId, anna.publicId],
          expenseDate: "2026-01-01",
        },
        created.revision,
      ),
    );

    const [expenseRow] = await db.select().from(expenses).where(eq(expenses.publicId, created.publicId));
    const rows = await db.select().from(expenseParticipants).where(eq(expenseParticipants.expenseId, expenseRow!.id));
    expect(rows).toHaveLength(2);
    const [peterRow] = await db.select().from(participants).where(eq(participants.publicId, peter.publicId));
    const participantIds = new Set(rows.map((r) => r.participantId));
    expect(participantIds.has(peterRow!.id)).toBe(false);
  });

  it("suggestRate considers both expenses and payments, taking the most recently updated", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);

    await db.transaction((tx) =>
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

    // A later repayment in the same foreign currency, with a different rate, should now win.
    await db.transaction((tx) =>
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

    const suggestion = await suggestRate(db, session.id, "EUR");
    expect(suggestion).toEqual({ rateText: "11,60", rateDirection: "base_per_unit" });
  });

  it("rejects an unknown payer or participant", async () => {
    const session = await createSession();
    const { johan } = await threeParticipants(session.id);

    await expect(
      db.transaction((tx) =>
        createExpense(tx, session, {
          description: "Dinner",
          amountText: "100",
          currencyCode: "SEK",
          payerPublicId: "does-not-exist",
          participantPublicIds: [johan.publicId],
          expenseDate: "2026-01-01",
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      db.transaction((tx) =>
        createExpense(tx, session, {
          description: "Dinner",
          amountText: "100",
          currencyCode: "SEK",
          payerPublicId: johan.publicId,
          participantPublicIds: [johan.publicId, "does-not-exist"],
          expenseDate: "2026-01-01",
        }),
      ),
    ).rejects.toMatchObject({ code: "UNKNOWN_PARTICIPANT" });
  });

  it("suggestRate returns the last used rate for a currency", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);

    expect(await suggestRate(db, session.id, "EUR")).toBeNull();

    await db.transaction((tx) =>
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

    const suggestion = await suggestRate(db, session.id, "EUR");
    expect(suggestion).toEqual({ rateText: "11,45", rateDirection: "base_per_unit" });
  });

  it("lists activity across expenses newest first", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);

    await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "First",
        amountText: "10",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );
    await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Second",
        amountText: "20",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-02",
      }),
    );

    const activity = await listActivity(db, session.id);
    expect(activity).toHaveLength(2);
    expect(activity[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(activity[1]!.createdAt.getTime());
  });

  it("lists expenses newest expense date first", async () => {
    const session = await createSession();
    const { johan, anna } = await threeParticipants(session.id);

    await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "Old",
        amountText: "10",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );
    await db.transaction((tx) =>
      createExpense(tx, session, {
        description: "New",
        amountText: "20",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-02-01",
      }),
    );

    const list = await listExpenses(db, session.id);
    expect(list.map((e) => e.description)).toEqual(["New", "Old"]);
  });

  it("cross-checks splitEqually directly against a hand-computed literal", () => {
    const shares = splitEqually(10000n, [
      { id: "a", position: 1 },
      { id: "b", position: 2 },
      { id: "c", position: 3 },
    ]);
    expect(shares).toEqual([
      { id: "a", share: 3334n },
      { id: "b", share: 3333n },
      { id: "c", share: 3333n },
    ]);
  });
});
