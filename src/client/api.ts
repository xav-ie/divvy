/** A failed API call; `message` is the server's `error`, ready to show. */
export class ApiError extends Error {
  readonly status: number;
  /** Extra fields of the error body, e.g. `existingExpenseId`. */
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

export const SESSION_EXPIRED =
  "Your sign-in expired. Reload the page to sign in again.";
const OFFLINE = "Couldn't reach the server. Check your connection.";

/**
 * After a failed or non-JSON response: an expired Cloudflare Access session
 * redirects /api/me to the login page, anything else means we're offline.
 */
async function diagnose(): Promise<ApiError> {
  try {
    const me = await fetch("/api/me", {
      redirect: "manual",
      cache: "no-store",
    });
    const json = me.headers.get("content-type")?.includes("json");
    return me.type === "opaqueredirect" || me.status === 401 || !json
      ? new ApiError(401, SESSION_EXPIRED)
      : new ApiError(0, OFFLINE);
  } catch {
    return new ApiError(0, OFFLINE);
  }
}

/** Call a JSON endpoint; throws ApiError with the server's message on failure. */
export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw await diagnose();
  }
  if (res.status === 204) return undefined as T;
  if (res.status === 401) throw new ApiError(401, SESSION_EXPIRED);
  const data = res.redirected ? null : await res.json().catch(() => null);
  if (data === null) throw await diagnose();
  if (!res.ok) {
    const body = data as { error?: string } & Record<string, unknown>;
    throw new ApiError(
      res.status,
      body.error ?? `Something went wrong (${res.status})`,
      body,
    );
  }
  return data as T;
}

/** The message to show for anything thrown by `api`. */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : "Something went wrong";
