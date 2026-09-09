import { and, desc, eq, lt, sql } from "drizzle-orm";

import type { DbOrTx } from "../auth/browser-session.ts";
import { revisions } from "../../db/schema.ts";

export type EntityType = "expense" | "payment" | "participant";
export type RevisionAction = "created" | "updated" | "deleted";

export interface RecordRevisionInput {
  sessionId: bigint;
  entityType: EntityType;
  entityId: bigint;
  revisionNo: number;
  action: RevisionAction;
  snapshot: unknown;
}

/** Writes one post-state revision row. Must run inside the caller's transaction. */
export async function recordRevision(tx: DbOrTx, input: RecordRevisionInput): Promise<void> {
  await tx.insert(revisions).values({
    sessionId: input.sessionId,
    entityType: input.entityType,
    entityId: input.entityId,
    revisionNo: input.revisionNo,
    action: input.action,
    snapshot: input.snapshot as object,
  });
}

export interface RevisionRow {
  revisionNo: number;
  action: RevisionAction;
  snapshot: unknown;
  createdAt: Date;
}

/**
 * Lists all revisions for one entity, identified by its PUBLIC id (stable across
 * renames/deletes because it is stored inside every snapshot), oldest first.
 *
 * Note: this filters on the jsonb expression `snapshot->>'publicId'`, which has no
 * index today. An expression index on `(entity_type, (snapshot->>'publicId'))` would
 * speed this up if activity/audit lookups become a hot path; not required for now.
 */
export async function listRevisionsForEntity(
  db: DbOrTx,
  sessionId: bigint,
  entityType: EntityType,
  publicId: string,
): Promise<RevisionRow[]> {
  const rows = await db
    .select({
      revisionNo: revisions.revisionNo,
      action: revisions.action,
      snapshot: revisions.snapshot,
      createdAt: revisions.createdAt,
    })
    .from(revisions)
    .where(
      and(
        eq(revisions.sessionId, sessionId),
        eq(revisions.entityType, entityType),
        sql`${revisions.snapshot}->>'publicId' = ${publicId}`,
      ),
    )
    .orderBy(revisions.revisionNo);
  return rows.map((r) => ({ ...r, action: r.action as RevisionAction }));
}

export interface ActivityRow {
  entityType: "expense" | "payment";
  action: RevisionAction;
  revisionNo: number;
  createdAt: Date;
  snapshot: unknown;
}

/**
 * Lists the newest revisions across expenses and payments (participants are
 * excluded from the activity feed), newest first, optionally paginated with
 * `before` (an exclusive cursor on `created_at`).
 */
export async function listActivity(
  db: DbOrTx,
  sessionId: bigint,
  { limit = 50, before }: { limit?: number; before?: Date } = {},
): Promise<ActivityRow[]> {
  const conditions = [
    eq(revisions.sessionId, sessionId),
    sql`${revisions.entityType} in ('expense', 'payment')`,
  ];
  if (before) {
    conditions.push(lt(revisions.createdAt, before));
  }
  const rows = await db
    .select({
      entityType: revisions.entityType,
      action: revisions.action,
      revisionNo: revisions.revisionNo,
      createdAt: revisions.createdAt,
      snapshot: revisions.snapshot,
    })
    .from(revisions)
    .where(and(...conditions))
    .orderBy(desc(revisions.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    entityType: r.entityType as "expense" | "payment",
    action: r.action as RevisionAction,
  }));
}
