import { route } from "../../../api/http.ts";
import {
  deleteRecurring,
  updateRecurring,
  type RecurringPatch,
} from "../../../services/recurring.ts";

export const PATCH = route(({ ctx, params, body }) =>
  updateRecurring(ctx, Number(params.recurringId), body as RecurringPatch),
);
export const DELETE = route(({ ctx, params }) =>
  deleteRecurring(ctx, Number(params.recurringId)),
);
