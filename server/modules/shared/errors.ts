/**
 * Base class for application-level errors that carry an HTTP status code.
 * Route handlers can catch `AppError` and map `status`/`toJSON()` directly
 * onto the HTTP response.
 */
export abstract class AppError extends Error {
  abstract readonly status: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** 404: the requested entity does not exist (or is not visible to the caller). */
export class NotFoundError extends AppError {
  readonly status = 404;

  constructor(message = "Not found") {
    super(message);
  }
}

/**
 * 409: an optimistic-concurrency check failed. Carries the entity's current
 * server-side state so the caller can show the user what changed.
 */
export class ConflictError extends AppError {
  readonly status = 409;
  readonly current: unknown;

  constructor(message: string, current: unknown) {
    super(message);
    this.current = current;
  }
}

/** 422: input failed validation. `code` is a stable machine-readable reason. */
export class ValidationError extends AppError {
  readonly status = 422;
  readonly field?: string;
  readonly code: string;

  constructor({ field, code, message }: { field?: string; code: string; message?: string }) {
    super(message ?? code);
    this.field = field;
    this.code = code;
  }
}
