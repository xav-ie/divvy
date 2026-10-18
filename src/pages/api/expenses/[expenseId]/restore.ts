import { route } from "../../../../api/http.ts";
import { restoreExpense } from "../../../../services/expenses.ts";

/** Undo a delete (within 7 days) -> the restored expense. */
export const POST = route(({ ctx, params }) =>
  restoreExpense(ctx, Number(params.expenseId)),
);
