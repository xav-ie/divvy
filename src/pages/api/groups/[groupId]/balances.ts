import { route } from "../../../../api/http.ts";
import { groupBalances } from "../../../../services/balances.ts";

export const GET = route(({ ctx, params }) =>
  groupBalances(ctx, Number(params.groupId)),
);
