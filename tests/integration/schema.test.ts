import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { expenseParticipants, expenses, participants, payments, sessions } from "../../server/db/schema.ts";
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
  return session;
}

describe("schema constraints", () => {
  it("enforces unique normalized participant names per session and allows a balanced expense", async () => {
    const session = await createSession();

    const [alice] = await db
      .insert(participants)
      .values({
        publicId: `p-${randomBytes(6).toString("hex")}`,
        sessionId: session.id,
        displayName: "Alice",
        normalizedName: "alice",
        position: 0,
      })
      .returning();

    const [bob] = await db
      .insert(participants)
      .values({
        publicId: `p-${randomBytes(6).toString("hex")}`,
        sessionId: session.id,
        displayName: "Bob",
        normalizedName: "bob",
        position: 1,
      })
      .returning();

    await expect(
      db.insert(participants).values({
        publicId: `p-${randomBytes(6).toString("hex")}`,
        sessionId: session.id,
        displayName: "Alice again",
        normalizedName: "alice",
        position: 2,
      }),
    ).rejects.toThrow();

    // A correctly-summed expense commits successfully.
    await db.transaction(async (tx) => {
      const [expense] = await tx
        .insert(expenses)
        .values({
          publicId: `e-${randomBytes(6).toString("hex")}`,
          sessionId: session.id,
          description: "Dinner",
          amountMinor: 1000n,
          currencyCode: "SEK",
          baseCurrencyCode: "SEK",
          baseAmountMinor: 1000n,
          splitMode: "equal",
          payerId: alice.id,
          expenseDate: "2026-01-01",
        })
        .returning();

      await tx.insert(expenseParticipants).values([
        {
          expenseId: expense.id,
          sessionId: session.id,
          participantId: alice.id,
          shareBaseMinor: 500n,
        },
        {
          expenseId: expense.id,
          sessionId: session.id,
          participantId: bob.id,
          shareBaseMinor: 500n,
        },
      ]);
    });

    const rows = await db.select().from(expenses);
    expect(rows.length).toBe(1);
  });

  it("rejects an expense whose shares do not sum to the base amount at commit", async () => {
    const session = await createSession();
    const [alice] = await db
      .insert(participants)
      .values({
        publicId: `p-${randomBytes(6).toString("hex")}`,
        sessionId: session.id,
        displayName: "Alice",
        normalizedName: "alice",
        position: 0,
      })
      .returning();
    const [bob] = await db
      .insert(participants)
      .values({
        publicId: `p-${randomBytes(6).toString("hex")}`,
        sessionId: session.id,
        displayName: "Bob",
        normalizedName: "bob",
        position: 1,
      })
      .returning();

    await expect(
      db.transaction(async (tx) => {
        const [expense] = await tx
          .insert(expenses)
          .values({
            publicId: `e-${randomBytes(6).toString("hex")}`,
            sessionId: session.id,
            description: "Unbalanced",
            amountMinor: 1000n,
            currencyCode: "SEK",
            baseCurrencyCode: "SEK",
            baseAmountMinor: 1000n,
            splitMode: "equal",
            payerId: alice.id,
            expenseDate: "2026-01-01",
          })
          .returning();

        await tx.insert(expenseParticipants).values([
          {
            expenseId: expense.id,
            sessionId: session.id,
            participantId: alice.id,
            shareBaseMinor: 400n,
          },
          {
            expenseId: expense.id,
            sessionId: session.id,
            participantId: bob.id,
            shareBaseMinor: 500n,
          },
        ]);
      }),
    ).rejects.toThrow();
  });

  it("enforces payer_id <> recipient_id on payments", async () => {
    const session = await createSession();
    const [alice] = await db
      .insert(participants)
      .values({
        publicId: `p-${randomBytes(6).toString("hex")}`,
        sessionId: session.id,
        displayName: "Alice",
        normalizedName: "alice",
        position: 0,
      })
      .returning();

    await expect(
      db.insert(payments).values({
        publicId: `pay-${randomBytes(6).toString("hex")}`,
        sessionId: session.id,
        amountMinor: 100n,
        currencyCode: "SEK",
        baseCurrencyCode: "SEK",
        baseAmountMinor: 100n,
        payerId: alice.id,
        recipientId: alice.id,
        paymentDate: "2026-01-01",
      }),
    ).rejects.toThrow();
  });
});
