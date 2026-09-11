import { sql } from "drizzle-orm";

import type { Database } from "../../db/client.ts";
import { purgeExpiredBrowserSessions } from "../auth/browser-session.ts";
import { purgeExpiredInvites } from "../session/invite.ts";
import { logger } from "../../logger.ts";

const expirationLogger = logger.child({ module: "expiration" });

export const CLEANUP_LOCK_KEY = 74610001n;

const BATCH_SIZE = 200;
// Guards against a runaway loop (e.g. the lock/delete predicate somehow never converging).
// At BATCH_SIZE=200 this allows purging up to 2,000,000 expired sessions in one run.
const MAX_BATCHES = 10_000;

interface CleanupResult {
  sessionsDeleted: number;
  browserSessionsDeleted: number;
  invitesDeleted: number;
  skipped: boolean;
}

interface BatchOutcome {
  locked: boolean;
  deleted: number;
}

/**
 * Deletes up to one batch of expired sessions inside its own transaction, guarded by the
 * advisory lock (`pg_try_advisory_xact_lock`, auto-released at commit/rollback). Running one
 * transaction per batch — rather than the whole purge in a single long-lived transaction — keeps
 * each transaction/snapshot short and lets `FOR UPDATE SKIP LOCKED` actually bound lock
 * contention per batch instead of holding row locks on everything purged in the run.
 */
async function deleteOneBatch(db: Database): Promise<BatchOutcome> {
  return db.transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lockResult: unknown = await (tx as any).execute(
      sql`SELECT pg_try_advisory_xact_lock(${CLEANUP_LOCK_KEY}) AS locked`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locked = (lockResult as any).rows?.[0]?.locked;
    if (!locked) {
      return { locked: false, deleted: 0 };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deleteResult: unknown = await (tx as any).execute(
      sql`DELETE FROM sessions WHERE id IN (
        SELECT id FROM sessions WHERE expires_at < now()
        ORDER BY id
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      ) RETURNING id`,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (deleteResult as any).rows ?? [];
    return { locked: true, deleted: rows.length };
  });
}

/**
 * Runs the session expiration cleanup job. Uses an advisory lock (re-acquired per batch, since
 * each batch is its own transaction) to ensure only one instance runs at a time across replicas.
 * Deletes expired sessions in batches of `BATCH_SIZE`, looping until a batch deletes 0 rows —
 * `FOR UPDATE SKIP LOCKED` can legitimately return fewer than a full batch while more expired
 * rows remain (e.g. they're momentarily locked by something else), so a short batch must not be
 * treated as "done".
 */
export interface CleanupTrigger {
  /** `schedule` for the hourly run, `admin` when the operator asked for it from the admin app. */
  trigger: "schedule" | "admin";
  /** The operator who asked, for admin-triggered runs. */
  actor?: string | null;
}

export async function runCleanup(
  db: Database,
  { trigger, actor = null }: CleanupTrigger = { trigger: "schedule" },
): Promise<CleanupResult> {
  const startedAt = new Date();
  const result = await purge(db);
  await recordRun(db, startedAt, trigger, actor, result);
  return result;
}

/**
 * Records the run for the admin app's maintenance history and keeps the admin tables bounded.
 * Best effort: a failure here must never fail the cleanup itself.
 */
async function recordRun(
  db: Database,
  startedAt: Date,
  trigger: CleanupTrigger["trigger"],
  actor: string | null,
  result: CleanupResult,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO admin.maintenance_runs
        (started_at, trigger, actor, sessions_deleted, browser_sessions_deleted, invites_deleted, skipped)
      VALUES (${startedAt}, ${trigger}, ${actor}, ${result.sessionsDeleted}, ${result.browserSessionsDeleted},
              ${result.invitesDeleted}, ${result.skipped})`);
    await db.execute(sql`DELETE FROM admin.maintenance_runs WHERE started_at < now() - interval '180 days'`);
    await db.execute(sql`DELETE FROM admin.audit_log WHERE at < now() - interval '365 days'`);
    await db.execute(sql`DELETE FROM admin.cleanup_requests WHERE handled_at < now() - interval '30 days'`);
  } catch (error) {
    expirationLogger.error({ error }, "cleanup: could not record the run");
  }
}

async function purge(db: Database): Promise<CleanupResult> {
  let sessionsDeleted = 0;
  let firstBatch = true;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const outcome = await deleteOneBatch(db);

    if (!outcome.locked) {
      if (firstBatch) {
        return { sessionsDeleted: 0, browserSessionsDeleted: 0, invitesDeleted: 0, skipped: true };
      }
      // Contended mid-run (rare: another instance grabbed the lock between our batches).
      // Stop here rather than block; the next scheduled run will pick up any remainder.
      expirationLogger.warn({ sessionsDeleted }, "cleanup: lost advisory lock mid-run, stopping early");
      break;
    }

    firstBatch = false;
    sessionsDeleted += outcome.deleted;
    if (outcome.deleted === 0) break;

    if (batch === MAX_BATCHES - 1) {
      expirationLogger.error(
        { sessionsDeleted, maxBatches: MAX_BATCHES },
        "cleanup: exceeded max batch iterations, aborting this run",
      );
    }
  }

  const browserSessionsDeleted = await purgeExpiredBrowserSessions(db);
  // Invites already cascade-delete with their session, so this only ever removes invites
  // whose group is still live: ones that expired, were used, or were revoked.
  const invitesDeleted = await purgeExpiredInvites(db);

  if (sessionsDeleted > 0 || browserSessionsDeleted > 0 || invitesDeleted > 0) {
    expirationLogger.info(
      { sessionsDeleted, browserSessionsDeleted, invitesDeleted, skipped: false },
      "cleanup completed",
    );
  }

  return { sessionsDeleted, browserSessionsDeleted, invitesDeleted, skipped: false };
}

interface SchedulerOptions {
  /** How often the regular cleanup runs. */
  intervalMs?: number;
  /** How often to check whether the operator asked for a cleanup from the admin app. */
  pollMs?: number;
}

interface Scheduler {
  stop(): void;
}

/** The oldest outstanding "run cleanup now" request from the admin app, if any. */
async function pendingRequest(db: Database): Promise<string | null> {
  const result = (await db.execute(
    sql`SELECT requested_by FROM admin.cleanup_requests WHERE handled_at IS NULL ORDER BY requested_at LIMIT 1`,
  )) as unknown as { rows?: { requested_by: string }[] };
  return result.rows?.[0]?.requested_by ?? null;
}

/**
 * Starts a cleanup scheduler that runs immediately and then every `intervalMs`, and checks every
 * `pollMs` for a "run cleanup now" request from the admin app, which it serves with the same
 * cleanup. The timer is unreferenced so it doesn't prevent process shutdown.
 */
export function startCleanupScheduler(db: Database, options: SchedulerOptions = {}): Scheduler {
  const { intervalMs = 60 * 60 * 1000, pollMs = 60 * 1000 } = options;
  let running = false;
  let lastScheduledRun = 0;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const requestedBy = await pendingRequest(db).catch(() => null);
      if (requestedBy !== null) {
        const result = await runCleanup(db, { trigger: "admin", actor: requestedBy });
        if (!result.skipped) {
          await db.execute(sql`UPDATE admin.cleanup_requests SET handled_at = now() WHERE handled_at IS NULL`);
        }
      } else if (Date.now() - lastScheduledRun >= intervalMs) {
        lastScheduledRun = Date.now();
        await runCleanup(db, { trigger: "schedule" });
      }
    } catch (error) {
      expirationLogger.error({ error }, "cleanup failed");
    } finally {
      running = false;
    }
  }

  // Run immediately, then keep checking.
  void tick();
  const timer = setInterval(tick, Math.min(pollMs, intervalMs));
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
