import { route } from "../../../../api/http.ts";
import { listEmails } from "../../../../services/emails.ts";

/** `{ emails: [{ id, email, primary, verifiedAt }], canLink }`. */
export const GET = route(({ ctx, locals }) =>
  listEmails(ctx, locals.auth.mode),
);
