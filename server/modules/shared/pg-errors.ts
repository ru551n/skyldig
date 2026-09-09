import type { DatabaseError } from "pg";

/**
 * Extracts the underlying `pg` `DatabaseError` from an error thrown by drizzle-orm.
 *
 * drizzle-orm 0.45 wraps every driver error in a `DrizzleQueryError`, with the original `pg`
 * error attached as `.cause` rather than spread onto the top-level error. Reading `err.code`
 * directly (as older code did) always reads `undefined` and silently defeats any check for a
 * specific Postgres error code (e.g. `23505` unique_violation, `25P02`
 * in_failed_sql_transaction).
 */
export function pgErrorOf(err: unknown): DatabaseError | undefined {
  const withCause = err as { cause?: unknown } | undefined;
  const candidate = (withCause?.cause ?? err) as DatabaseError | undefined;
  return candidate?.code ? candidate : undefined;
}

/** True if `err` is a unique-violation (23505) on the named constraint. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const dbErr = pgErrorOf(err);
  return !!dbErr && dbErr.code === "23505" && dbErr.constraint === constraint;
}
