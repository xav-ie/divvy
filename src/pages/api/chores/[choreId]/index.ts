import { route } from "../../../../api/http.ts";
import {
  deleteChore,
  updateChore,
  type ChorePatch,
} from "../../../../services/chores.ts";

export const PATCH = route(({ ctx, params, body }) =>
  updateChore(ctx, Number(params.choreId), body as ChorePatch),
);
export const DELETE = route(({ ctx, params }) =>
  deleteChore(ctx, Number(params.choreId)),
);
