import { route } from "../../../../../api/http.ts";
import { previewVenmo } from "../../../../../services/venmoProfile.ts";

/** `{ venmo }` -> what the "Is this you?" card shows; saves nothing. */
export const POST = route(({ ctx, body }) =>
  previewVenmo(ctx, (body ?? {}) as { venmo: unknown }),
);
