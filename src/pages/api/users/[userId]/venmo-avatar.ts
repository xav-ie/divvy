import type { APIRoute } from "astro";
import { json } from "../../../../api/http.ts";
import { ServiceError } from "../../../../services/errors.ts";
import { readVenmoAvatar } from "../../../../services/venmoProfile.ts";

/** divvy's copy of a user's Venmo photo, so browsers never load from Venmo. */
export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const { bytes, mime } = await readVenmoAvatar(
      locals.ctx,
      Number(params.userId),
    );
    return new Response(bytes, {
      headers: {
        "content-type": mime,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox; default-src 'none'",
        "cache-control": "private, max-age=300",
      },
    });
  } catch (err) {
    if (err instanceof ServiceError)
      return json({ error: err.message }, err.status);
    throw err;
  }
};
