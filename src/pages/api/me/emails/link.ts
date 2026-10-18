import { route } from "../../../../api/http.ts";
import { createLinkCode } from "../../../../services/emails.ts";

/** A single-use link code for another sign-in email: `{ code, path, expires }`. */
export const POST = route(({ ctx, locals }) =>
  createLinkCode(ctx, locals.auth.mode),
);
