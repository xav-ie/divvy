import { route } from "../../../../api/http.ts";
import { addAway, type AwayInput } from "../../../../services/chores.ts";

export const POST = route(({ ctx, params, body }) =>
  addAway(ctx, Number(params.groupId), body as AwayInput),
);
