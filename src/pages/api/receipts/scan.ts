import type { APIRoute } from "astro";
import { json } from "../../../api/http.ts";
import { ServiceError } from "../../../services/errors.ts";
import { scanConfigured } from "../../../receipts/scan.ts";
import { scanAndStore } from "../../../services/receipts.ts";

/** Multipart with an image in `file`; returns the scanned receipt. */
export const POST: APIRoute = async ({ locals, request }) => {
  if (!scanConfigured())
    return json(
      {
        error:
          "Receipt scanning isn't set up on this server. Enter the items by hand.",
      },
      503,
    );
  try {
    const form = await request.formData().catch(() => undefined);
    const file = form?.get("file");
    if (!(file instanceof File))
      return json({ error: "Attach a photo of the receipt" }, 400);
    return json(
      await scanAndStore(locals.ctx, new Uint8Array(await file.arrayBuffer())),
    );
  } catch (err) {
    if (err instanceof ServiceError)
      return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "Something went wrong on the server" }, 500);
  }
};
