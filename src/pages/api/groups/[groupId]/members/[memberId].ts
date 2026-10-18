import { route } from "../../../../../api/http.ts";
import {
  removeMember,
  updatePlaceholder,
} from "../../../../../services/members.ts";
import type { MemberPatch } from "../../../../../services/schemas.ts";

/** Rename a placeholder and/or invite it by email: `{ name?, email? }`. */
export const PATCH = route(({ ctx, params, body }) =>
  updatePlaceholder(
    ctx,
    Number(params.groupId),
    Number(params.memberId),
    body as MemberPatch,
  ),
);
export const DELETE = route(({ ctx, params }) =>
  removeMember(ctx, Number(params.groupId), Number(params.memberId)),
);
