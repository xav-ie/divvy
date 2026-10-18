import type { APIRoute } from "astro";
import { json, route } from "../../../api/http.ts";
import {
  readAttachment,
  removeAttachment,
} from "../../../services/attachments.ts";
import { ServiceError } from "../../../services/errors.ts";

/**
 * Serves the file inline with its sniffed type (`?download=1` as a download). Files are never HTML or SVG,
 * and the sandbox CSP plus nosniff keep a hostile PDF or image from running
 * script against the app.
 */
export const GET: APIRoute = async ({ locals, params, url }) => {
  try {
    const f = await readAttachment(locals.ctx, Number(params.attachmentId));
    const ascii = f.filename.replace(/[^\x20-\x7e]|["\\\\]/g, "_");
    return new Response(f.bytes, {
      headers: {
        "content-type": f.mime,
        "content-disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy":
          f.mime === "application/pdf"
            ? "sandbox"
            : "sandbox; default-src 'none'",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch (err) {
    if (err instanceof ServiceError)
      return json({ error: err.message }, err.status);
    throw err;
  }
};

export const DELETE = route(({ ctx, params }) =>
  removeAttachment(ctx, Number(params.attachmentId)),
);
