import type { APIRoute } from "astro";
import { json } from "../../../api/http.ts";
import { ServiceError } from "../../../services/errors.ts";
import { readReceipt } from "../../../services/receipts.ts";

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const { bytes, mediaType } = await readReceipt(
      locals.ctx,
      Number(params.receiptId),
    );
    return new Response(bytes, {
      headers: {
        "content-type": mediaType,
        "cache-control": "private, max-age=86400",
      },
    });
  } catch (err) {
    if (err instanceof ServiceError)
      return json({ error: err.message }, err.status);
    throw err;
  }
};
