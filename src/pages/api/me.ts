import { route } from "../../api/http.ts";
import type { ProfileInput } from "../../services/schemas.ts";
import { updateProfile } from "../../services/users.ts";

export const GET = route(({ ctx }) => ctx.user);
/**
 * `{ name?, venmo?, previewId? }`. A new Venmo username needs the `previewId`
 * of a POST /api/me/venmo/preview that found it (400 otherwise); its photo is kept.
 */
export const PATCH = route(({ ctx, body }) =>
  updateProfile(ctx, body as ProfileInput),
);
