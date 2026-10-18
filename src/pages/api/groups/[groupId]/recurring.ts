import { route } from "../../../../api/http.ts";
import {
  createRecurring,
  listRecurring,
  type RecurringInput,
} from "../../../../services/recurring.ts";

export const GET = route(({ ctx, params }) =>
  listRecurring(ctx, Number(params.groupId)),
);
export const POST = route(({ ctx, params, body }) =>
  createRecurring(ctx, Number(params.groupId), body as RecurringInput),
);
