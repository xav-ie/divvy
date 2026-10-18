import type { APIRoute } from "astro";
import { json } from "../../../../../api/http.ts";
import { ServiceError } from "../../../../../services/errors.ts";
import { readPreviewPhoto } from "../../../../../services/venmoProfile.ts";

/** The previewed Venmo photo, only for the user who asked for the preview. */
export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const { bytes, mime } = await readPreviewPhoto(
      locals.ctx,
      String(params.previewId),
    );
    return new Response(bytes, {
      headers: {
        "content-type": mime,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof ServiceError)
      return json({ error: err.message }, err.status);
    throw err;
  }
};
