import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  addParticipant,
  addParticipants,
  deleteParticipant,
  getParticipantByPublicId,
  listParticipants,
  normalizeName,
  renameParticipant,
} from "../../server/modules/participants/participants.ts";
import { createExpense } from "../../server/modules/expenses/expenses.ts";
import { revisions, sessions } from "../../server/db/schema.ts";
import { eq } from "drizzle-orm";
import { ConflictError, ValidationError } from "../../server/modules/shared/errors.ts";
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

describe("normalizeName", () => {
  it("collapses whitespace, trims and lowercases with sv-SE rules", () => {
    expect(normalizeName("  Anna   Andersson  ")).toBe("anna andersson");
    expect(normalizeName("ANNA")).toBe("anna");
    expect(normalizeName("anna ")).toBe("anna");
  });
});

describe("participants module", () => {
  it("adds participants and assigns sequential positions", async () => {
    const session = await createSession();
    const a = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    const b = await db.transaction((tx) => addParticipant(tx, session.id, "Anna"));
    const c = await db.transaction((tx) => addParticipant(tx, session.id, "Peter"));

    expect(a.position).toBe(1);
    expect(b.position).toBe(2);
    expect(c.position).toBe(3);

    const list = await listParticipants(db, session.id);
    expect(list.map((p) => p.displayName)).toEqual(["Johan", "Anna", "Peter"]);
  });

  it("rejects normalized-name collisions", async () => {
    const session = await createSession();
    await db.transaction((tx) => addParticipant(tx, session.id, "Anna"));

    for (const name of ["anna ", "ANNA", "  anna"]) {
      await expect(db.transaction((tx) => addParticipant(tx, session.id, name))).rejects.toMatchObject({
        code: "PARTICIPANT_NAME_TAKEN",
        field: "displayName",
      });
    }
  });

  it("renames a participant with the correct revision", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    expect(created.revision).toBe(1);

    const renamed = await db.transaction((tx) => renameParticipant(tx, session.id, created.publicId, "Johan A", created.revision));
    expect(renamed.displayName).toBe("Johan A");
    expect(renamed.revision).toBe(2);
  });

  it("rejects a rename with a stale revision and returns the current state", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    await db.transaction((tx) => renameParticipant(tx, session.id, created.publicId, "Johan A", created.revision));

    let error: unknown;
    try {
      await db.transaction((tx) => renameParticipant(tx, session.id, created.publicId, "Johan B", created.revision));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConflictError);
    const conflict = error as ConflictError;
    expect((conflict.current as { displayName: string }).displayName).toBe("Johan A");
    expect((conflict.current as { revision: number }).revision).toBe(2);
  });

  it("deletes an unreferenced participant", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    await db.transaction((tx) => deleteParticipant(tx, session.id, created.publicId, created.revision));

    await expect(getParticipantByPublicId(db, session.id, created.publicId)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses to delete a participant referenced by an expense", async () => {
    const session = await createSession();
    const johan = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    const anna = await db.transaction((tx) => addParticipant(tx, session.id, "Anna"));

    await db.transaction((tx) =>
      createExpense(tx, { id: session.id, baseCurrency: session.baseCurrency }, {
        description: "Dinner",
        amountText: "100",
        currencyCode: "SEK",
        payerPublicId: johan.publicId,
        participantPublicIds: [johan.publicId, anna.publicId],
        expenseDate: "2026-01-01",
      }),
    );

    await expect(
      db.transaction((tx) => deleteParticipant(tx, session.id, johan.publicId, johan.revision)),
    ).rejects.toMatchObject({ code: "PARTICIPANT_HAS_HISTORY" });
  });

  it("concurrent addParticipant in two overlapping transactions assigns distinct positions with no unique violation", async () => {
    const session = await createSession();

    // Start both transactions and get past their initial work before either commits, so the
    // `FOR UPDATE` session-row lock in addParticipant (participants.ts lockSession) is what
    // actually serializes them rather than accidental ordering.
    let releaseA!: () => void;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const txA = db.transaction(async (tx) => {
      const created = await addParticipant(tx, session.id, "Alice");
      // Hold this transaction open until B has had a chance to start and block on the lock.
      await gateA;
      return created;
    });

    // Give A a moment to acquire the session-row lock before starting B.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const txB = db.transaction((tx) => addParticipant(tx, session.id, "Bob"));

    // Let A proceed to commit after a short delay, once B is blocked waiting on the lock.
    await new Promise((resolve) => setTimeout(resolve, 50));
    releaseA();

    const [a, b] = await Promise.all([txA, txB]);

    expect(a.position).not.toBe(b.position);
    expect(new Set([a.position, b.position]).size).toBe(2);

    const list = await listParticipants(db, session.id);
    expect(list).toHaveLength(2);
    const positions = list.map((p) => p.position).sort((x, y) => x - y);
    expect(positions).toEqual([1, 2]);
  });

  it("addParticipants rejects duplicate names within the input", async () => {
    const session = await createSession();
    await expect(
      db.transaction((tx) => addParticipants(tx, session.id, ["Johan", "Anna", "johan"])),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("addParticipants adds all names in order when there is no collision", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => addParticipants(tx, session.id, ["Johan", "Anna", "Peter"]));
    expect(created.map((p) => p.displayName)).toEqual(["Johan", "Anna", "Peter"]);
    expect(created.map((p) => p.position)).toEqual([1, 2, 3]);
  });

  it("records revisions for created, updated and deleted participants", async () => {
    const session = await createSession();
    const created = await db.transaction((tx) => addParticipant(tx, session.id, "Johan"));
    await db.transaction((tx) => renameParticipant(tx, session.id, created.publicId, "Johan A", created.revision));
    await db.transaction((tx) => deleteParticipant(tx, session.id, created.publicId, 2));

    const rows = await db
      .select()
      .from(revisions)
      .where(eq(revisions.sessionId, session.id))
      .orderBy(revisions.revisionNo);

    expect(rows.map((r) => r.action)).toEqual(["created", "updated", "deleted"]);
    expect(rows.map((r) => r.revisionNo)).toEqual([1, 2, 3]);
    for (const row of rows) {
      expect((row.snapshot as { publicId: string }).publicId).toBe(created.publicId);
    }
  });
});
