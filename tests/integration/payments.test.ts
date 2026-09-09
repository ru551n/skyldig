import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { addParticipant } from "../../server/modules/participants/participants.ts";
import { createPayment, deletePayment, getPayment, updatePayment } from "../../server/modules/payments/payments.ts";
import { listRevisionsForEntity } from "../../server/modules/audit/audit.ts";
import { ConflictError, ValidationError } from "../../server/modules/shared/errors.ts";
import { convertToBase, parseAmount, parseRate } from "../../domain/index.ts";
import { payments, sessions } from "../../server/db/schema.ts";
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

async function twoParticipants(sessionId: bigint) {
  const johan = await db.transaction((tx) => addParticipant(tx, sessionId, "Johan"));
  const anna = await db.transaction((tx) => addParticipant(tx, sessionId, "Anna"));
  return { johan, anna };
}

describe("payments module", () => {
  it("creates a payment", async () => {
    const session = await createSession();
    const { johan, anna } = await twoParticipants(session.id);

    const payment = await db.transaction((tx) =>
      createPayment(tx, session, {
        amountText: "500",
        currencyCode: "SEK",
        payerPublicId: anna.publicId,
        recipientPublicId: johan.publicId,
        paymentDate: "2026-01-03",
      }),
    );

    expect(payment.amountMinor).toBe(50000n);
    expect(payment.baseAmountMinor).toBe(50000n);
    expect(payment.revision).toBe(1);
    expect(payment.payer.publicId).toBe(anna.publicId);
    expect(payment.recipient.publicId).toBe(johan.publicId);
  });

  it("updates a payment and bumps the revision", async () => {
    const session = await createSession();
    const { johan, anna } = await twoParticipants(session.id);
    const created = await db.transaction((tx) =>
      createPayment(tx, session, {
        amountText: "500",
        currencyCode: "SEK",
        payerPublicId: anna.publicId,
        recipientPublicId: johan.publicId,
        paymentDate: "2026-01-03",
      }),
    );

    const updated = await db.transaction((tx) =>
      updatePayment(
        tx,
        session,
        created.publicId,
        {
          amountText: "600",
          currencyCode: "SEK",
          payerPublicId: anna.publicId,
          recipientPublicId: johan.publicId,
          paymentDate: "2026-01-04",
        },
        created.revision,
      ),
    );

    expect(updated.revision).toBe(2);
    expect(updated.amountMinor).toBe(60000n);

    const revs = await listRevisionsForEntity(db, session.id, "payment", created.publicId);
    expect(revs.map((r) => r.action)).toEqual(["created", "updated"]);
  });

  it("deletes a payment and records the deleted snapshot", async () => {
    const session = await createSession();
    const { johan, anna } = await twoParticipants(session.id);
    const created = await db.transaction((tx) =>
      createPayment(tx, session, {
        amountText: "500",
        currencyCode: "SEK",
        payerPublicId: anna.publicId,
        recipientPublicId: johan.publicId,
        paymentDate: "2026-01-03",
      }),
    );

    await db.transaction((tx) => deletePayment(tx, session, created.publicId, created.revision));

    await expect(getPayment(db, session.id, created.publicId)).rejects.toMatchObject({ status: 404 });
    const rows = await db.select().from(payments).where(eq(payments.publicId, created.publicId));
    expect(rows).toHaveLength(0);

    const revs = await listRevisionsForEntity(db, session.id, "payment", created.publicId);
    expect(revs.map((r) => r.action)).toEqual(["created", "deleted"]);
  });

  it("rejects a stale revision on update, carrying the current state", async () => {
    const session = await createSession();
    const { johan, anna } = await twoParticipants(session.id);
    const created = await db.transaction((tx) =>
      createPayment(tx, session, {
        amountText: "500",
        currencyCode: "SEK",
        payerPublicId: anna.publicId,
        recipientPublicId: johan.publicId,
        paymentDate: "2026-01-03",
      }),
    );

    let error: unknown;
    try {
      await db.transaction((tx) =>
        updatePayment(
          tx,
          session,
          created.publicId,
          {
            amountText: "700",
            currencyCode: "SEK",
            payerPublicId: anna.publicId,
            recipientPublicId: johan.publicId,
            paymentDate: "2026-01-03",
          },
          99,
        ),
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).current).toMatchObject({ amountMinor: 50000n });
  });

  it("rejects a payment where payer equals recipient", async () => {
    const session = await createSession();
    const { johan } = await twoParticipants(session.id);

    await expect(
      db.transaction((tx) =>
        createPayment(tx, session, {
          amountText: "500",
          currencyCode: "SEK",
          payerPublicId: johan.publicId,
          recipientPublicId: johan.publicId,
          paymentDate: "2026-01-03",
        }),
      ),
    ).rejects.toMatchObject({ code: "SAME_PARTICIPANT" });
    // Also ensure it's a ValidationError instance (not the DB CHECK exception).
    await expect(
      db.transaction((tx) =>
        createPayment(tx, session, {
          amountText: "500",
          currencyCode: "SEK",
          payerPublicId: johan.publicId,
          recipientPublicId: johan.publicId,
          paymentDate: "2026-01-03",
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("converts a foreign-currency payment to base currency", async () => {
    const session = await createSession();
    const { johan, anna } = await twoParticipants(session.id);

    const payment = await db.transaction((tx) =>
      createPayment(tx, session, {
        amountText: "20",
        currencyCode: "EUR",
        rateText: "11,45",
        rateDirection: "base_per_unit",
        payerPublicId: anna.publicId,
        recipientPublicId: johan.publicId,
        paymentDate: "2026-01-03",
      }),
    );

    const amountMinor = parseAmount("20", "EUR");
    const rate = parseRate("11,45", "base_per_unit");
    const expected = convertToBase({ amountMinor, currency: "EUR" }, "SEK", rate);
    expect(payment.baseAmountMinor).toBe(expected);
    expect(payment.baseAmountMinor).toBe(22900n);
  });
});
