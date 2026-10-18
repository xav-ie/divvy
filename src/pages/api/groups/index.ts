import { route } from "../../../api/http.ts";
import { createGroup, listGroups } from "../../../services/groups.ts";
import type { GroupInput } from "../../../services/schemas.ts";

export const GET = route(({ ctx }) => listGroups(ctx));
export const POST = route(({ ctx, body }) =>
  createGroup(ctx, body as GroupInput),
);
