import { route } from "../../../../api/http.ts";
import {
  createChore,
  listChores,
  type ChoreInput,
} from "../../../../services/chores.ts";

export const GET = route(({ ctx, params }) =>
  listChores(ctx, Number(params.groupId)),
);
export const POST = route(({ ctx, params, body }) =>
  createChore(ctx, Number(params.groupId), body as ChoreInput),
);
