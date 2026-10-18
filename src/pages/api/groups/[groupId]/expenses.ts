import { publicExpense, route } from "../../../../api/http.ts";
import {
  createExpense,
  listExpenses,
  previewExpense,
} from "../../../../services/expenses.ts";
import { receiptPathFor } from "../../../../services/receipts.ts";
import { linkAttachments } from "../../../../services/attachments.ts";
import { transaction } from "../../../../db/transaction.ts";
import type { ExpenseInput } from "../../../../services/schemas.ts";

export const GET = route(({ ctx, params }) =>
  listExpenses(ctx, Number(params.groupId)),
);

/**
 * `?dryRun=1` validates and returns the computed shares without saving.
 * Optional `receiptId` links a scanned receipt; `attachmentIds` links files
 * uploaded to POST /api/attachments for this expense.
 */
export const POST = route(({ ctx, params, body, url }) => {
  const groupId = Number(params.groupId);
  const input = publicExpense(body) as ExpenseInput;
  if (url.searchParams.get("dryRun"))
    return previewExpense(ctx, groupId, input);
  const extra = body as { receiptId?: unknown; attachmentIds?: unknown } | null;
  return transaction(ctx.db, () => {
    const e = createExpense(ctx, groupId, {
      ...input,
      ...receiptPathFor(ctx, groupId, extra?.receiptId),
    });
    linkAttachments(ctx, e.id, extra?.attachmentIds);
    return e;
  });
});
