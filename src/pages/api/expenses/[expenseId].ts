import { publicExpense, route } from "../../../api/http.ts";
import {
  deleteExpense,
  getExpense,
  updateExpense,
} from "../../../services/expenses.ts";
import { receiptPathFor } from "../../../services/receipts.ts";
import { linkAttachments } from "../../../services/attachments.ts";
import { transaction } from "../../../db/transaction.ts";
import type { ExpenseInput } from "../../../services/schemas.ts";

export const GET = route(({ ctx, params }) =>
  getExpense(ctx, Number(params.expenseId)),
);
/**
 * Optional `receiptId`: omit to keep the receipt, null to remove it.
 * Optional `attachmentIds`: newly uploaded files to attach.
 */
export const PUT = route(({ ctx, params, body }) => {
  const expenseId = Number(params.expenseId);
  const { groupId } = getExpense(ctx, expenseId);
  const extra = body as { receiptId?: unknown; attachmentIds?: unknown } | null;
  return transaction(ctx.db, () => {
    const e = updateExpense(ctx, expenseId, {
      ...(publicExpense(body) as ExpenseInput),
      ...receiptPathFor(ctx, groupId, extra?.receiptId),
    });
    linkAttachments(ctx, e.id, extra?.attachmentIds);
    return e;
  });
});
export const DELETE = route(({ ctx, params }) =>
  deleteExpense(ctx, Number(params.expenseId)),
);
