import { route } from "../../../../api/http.ts";
import {
  billRecurring,
  type BillInput,
} from "../../../../services/recurring.ts";

/** `{ month?, confirmDuplicate? }` -> `{ expenseId }`, for the template's fixed amount. */
export const POST = route(({ ctx, params, body }) =>
  billRecurring(ctx, Number(params.recurringId), body as BillInput),
);
