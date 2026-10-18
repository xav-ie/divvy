import type { APIContext, APIRoute } from "astro";
import type { Ctx } from "../services/context.ts";
import { ServiceError } from "../services/errors.ts";

/** API responses are per-user and live; never cache them. */
export function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export interface Call {
  ctx: Ctx;
  locals: APIContext["locals"];
  params: APIContext["params"];
  url: URL;
  /** Parsed JSON body (`{}` when there is none); services validate it with Zod. */
  body: unknown;
}

/**
 * Wrap a handler as an Astro route: parses the JSON body, returns the result
 * as JSON (204 for undefined), and maps ServiceError to `{ error }` with its status.
 */
export function route(handler: (call: Call) => unknown): APIRoute {
  return async ({ locals, params, request, url }) => {
    let body: unknown = {};
    if (request.method !== "GET" && request.method !== "DELETE") {
      const text = await request.text();
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        return json({ error: "The request body isn't valid JSON" }, 400);
      }
    }
    try {
      const out = await handler({ ctx: locals.ctx, locals, params, url, body });
      return out === undefined
        ? new Response(null, { status: 204 })
        : json(out);
    } catch (err) {
      if (err instanceof ServiceError)
        return json({ ...err.data, error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong on the server" }, 500);
    }
  };
}

/** Drop fields only trusted callers (MCP, recurring) may set. */
export function publicExpense(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const {
    receiptPath: _r,
    recurringId: _i,
    oddCentsTo: _o,
    ...rest
  } = body as Record<string, unknown>;
  return rest;
}

/** A multipart upload's `file` (and optional `label`), as raw bytes. */
export interface Upload {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  label: string | null;
}

/**
 * Like route(), for multipart uploads: hands the handler the form's `file`
 * field (400 without one) instead of a JSON body.
 */
export function uploadRoute(
  handler: (call: Omit<Call, "body"> & { upload: Upload }) => unknown,
): APIRoute {
  return async ({ locals, params, request, url }) => {
    try {
      const form = await request.formData().catch(() => undefined);
      const file = form?.get("file");
      if (!(file instanceof File))
        return json({ error: 'Attach a file in the "file" field' }, 400);
      const label = form?.get("label");
      const upload = {
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: file.name,
        label: typeof label === "string" ? label : null,
      };
      return json(
        await handler({ ctx: locals.ctx, locals, params, url, upload }),
      );
    } catch (err) {
      if (err instanceof ServiceError)
        return json({ ...err.data, error: err.message }, err.status);
      console.error(err);
      return json({ error: "Something went wrong on the server" }, 500);
    }
  };
}
