import { route } from "../../../../api/http.ts";
import { swapTurn, type SwapInput } from "../../../../services/chores.ts";

export const POST = route(({ ctx, params, body }) =>
  swapTurn(ctx, Number(params.choreId), body as SwapInput),
);
