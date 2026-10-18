import { route } from "../../../../../api/http.ts";
import { addMember } from "../../../../../services/members.ts";
import type { MemberInput } from "../../../../../services/schemas.ts";

export const POST = route(({ ctx, params, body }) =>
  addMember(ctx, Number(params.groupId), body as MemberInput),
);
