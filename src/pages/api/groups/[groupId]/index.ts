import { route } from "../../../../api/http.ts";
import {
  deleteGroup,
  getGroup,
  updateGroup,
} from "../../../../services/groups.ts";
import type { GroupPatch } from "../../../../services/schemas.ts";

export const GET = route(({ ctx, params }) =>
  getGroup(ctx, Number(params.groupId)),
);
export const PATCH = route(({ ctx, params, body }) =>
  updateGroup(ctx, Number(params.groupId), body as GroupPatch),
);
export const DELETE = route(({ ctx, params }) =>
  deleteGroup(ctx, Number(params.groupId)),
);
