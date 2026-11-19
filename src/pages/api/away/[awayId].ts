import { route } from "../../../api/http.ts";
import { deleteAway } from "../../../services/chores.ts";

export const DELETE = route(({ ctx, params }) =>
  deleteAway(ctx, Number(params.awayId)),
);
