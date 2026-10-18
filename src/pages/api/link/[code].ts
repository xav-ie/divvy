import { route } from "../../../api/http.ts";
import { useLink } from "../../../services/emails.ts";

/** Attach the email this request signed in with to the link's owner. */
export const POST = route(({ ctx, locals, params }) => {
  const r = useLink(
    ctx.db,
    String(params.code),
    locals.email,
    locals.auth.mode,
  );
  return { email: r.email, name: r.user.name, merged: r.merged };
});
