import { route } from "../../../../api/http.ts";
import { makePrimary, removeEmail } from "../../../../services/emails.ts";

/** `{ primary: true }` makes it the primary email; returns the list. */
export const PATCH = route(({ ctx, params }) =>
  makePrimary(ctx, Number(params.emailId)),
);
export const DELETE = route(({ ctx, params }) =>
  removeEmail(ctx, Number(params.emailId)),
);
