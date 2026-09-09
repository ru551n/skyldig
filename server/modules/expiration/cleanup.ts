import { sql } from "drizzle-orm";

import type { Database } from "../../db/client.ts";
import { purgeExpiredBrowserSessions } from "../auth/browser-session.ts";
import { logger } from "../../logger.ts";

const expirationLogger = logger.child({ module: "expiration" });

export const CLEANUP_LOCK_KEY = 74610001n;

interface CleanupResult {
  sessionsDeleted: number;
  browserSessionsDeleted: number;
  skipped: boolean;
}

/**
 * Runs the session expiration cleanup job. Uses an advisory lock to ensure only one
 * instance runs at a time across replicas. Deletes expired sessions in batches of 200
 * until none remain, then purges expired browser sessions.
 */
export async function runCleanup(db: Database): Promise<CleanupResult> {
  return db.transaction(async (tx) => {
    // Try to acquire an exclusive advisory lock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lockResult: unknown = await (tx as any).execute(
      sql`SELECT pg_try_advisory_xact_lock(${CLEANUP_LOCK_KEY}) AS locked`
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const locked = (lockResult as any).rows?.[0]?.locked;

    if (!locked) {
      return { sessionsDeleted: 0, browserSessionsDeleted: 0, skipped: true };
    }

    let sessionsDeleted = 0;

    // Delete expired sessions in batches of 200 until none remain
    while (true) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deleteResult: unknown = await (tx as any).execute(
        sql`DELETE FROM sessions WHERE id IN (
          SELECT id FROM sessions WHERE expires_at < now()
          ORDER BY id
          LIMIT 200
          FOR UPDATE SKIP LOCKED
        ) RETURNING id`
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batchRows = (deleteResult as any).rows ?? [];
      const batchSize = batchRows.length;
      sessionsDeleted += batchSize;

      if (batchSize < 200) {
        // No more sessions to delete
        break;
      }
    }

    // Purge expired browser sessions
    const browserSessionsDeleted = await purgeExpiredBrowserSessions(tx);

    if (sessionsDeleted > 0 || browserSessionsDeleted > 0) {
      expirationLogger.info(
        { sessionsDeleted, browserSessionsDeleted, skipped: false },
        "cleanup completed"
      );
    }

    return { sessionsDeleted, browserSessionsDeleted, skipped: false };
  });
}

interface SchedulerOptions {
  intervalMs?: number;
}

interface Scheduler {
  stop(): void;
}

/**
 * Starts a cleanup scheduler that runs immediately and then on a recurring interval.
 * The timer is unreferenced so it doesn't prevent process shutdown.
 */
export function startCleanupScheduler(db: Database, options: SchedulerOptions = {}): Scheduler {
  const { intervalMs = 60 * 60 * 1000 } = options;
  let running = false;

  async function runSafely() {
    if (running) return;
    running = true;
    try {
      await runCleanup(db);
    } catch (error) {
      expirationLogger.error({ error }, "cleanup failed");
    } finally {
      running = false;
    }
  }

  // Run immediately
  void runSafely();

  // Schedule recurring runs
  const timer = setInterval(runSafely, intervalMs);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}
