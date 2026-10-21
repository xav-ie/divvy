import type { APIRoute } from "astro";
import { ServiceError } from "../services/errors.ts";
import { keepReceipt } from "../services/receipts.ts";

/**
 * The installed app's share target (manifest `share_target`): a photo shared
 * from another app becomes a receipt on a new expense. Keeps the photo, then
 * sends the browser to pick a group (/expenses/new), which reads it.
 */
export const POST: APIRoute = async ({ locals, request, redirect }) => {
  const form = await request.formData().catch(() => undefined);
  const file = form?.getAll("receipt").find((f) => f instanceof File);
  if (!(file instanceof File))
    return redirect(
      `/expenses/new?error=${encodeURIComponent("Share a photo of a receipt")}`,
      303,
    );
  try {
    const receiptId = await keepReceipt(
      locals.ctx,
      new Uint8Array(await file.arrayBuffer()),
    );
    return redirect(`/expenses/new?receipt=${receiptId}`, 303);
  } catch (err) {
    if (!(err instanceof ServiceError)) throw err;
    return redirect(
      `/expenses/new?error=${encodeURIComponent(err.message)}`,
      303,
    );
  }
};

/** Opened by hand: nothing was shared. */
export const GET: APIRoute = ({ redirect }) => redirect("/expenses/new", 302);
