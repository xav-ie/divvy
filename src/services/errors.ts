/** A failure the caller should show the user; `status` is the HTTP status for the API. */
export class ServiceError extends Error {
  readonly status: number;
  /** Extra fields for the API's error body, e.g. `{ existingExpenseId }`. */
  readonly data: Record<string, unknown>;
  constructor(
    status: number,
    message: string,
    data: Record<string, unknown> = {},
  ) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/** 404. Also used for things that exist but the user can't see, so groups don't leak. */
export const notFound = (what: string) =>
  new ServiceError(404, `${what} not found`);
export const forbidden = (message: string) => new ServiceError(403, message);
export const invalid = (message: string) => new ServiceError(400, message);
export const conflict = (message: string) => new ServiceError(409, message);
