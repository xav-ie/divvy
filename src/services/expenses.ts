import { insertAudit } from "../db/audit.ts";
import * as repo from "../db/expenses.ts";
import { groupMembers } from "../db/groups.ts";
import { markBilled, releaseMonth } from "../db/recurring.ts";
import { memberForUser } from "../db/members.ts";
import { transaction } from "../db/transaction.ts";
import { monthOf } from "../domain/recurring.ts";
import { formatCents, splitSeed } from "../domain/money.ts";
import { adjustmentCents, computeSplit, payerErrors } from "../domain/split.ts";
import type { Adjustments, Amounts, Cents } from "../domain/types.ts";
import { requireGroup, requireRestorable, type Ctx } from "./context.ts";
import { forbidden, invalid, notFound, ServiceError } from "./errors.ts";
import { monthName } from "./recurring.ts";
import { parse } from "./parse.ts";
import { ExpenseInput, id } from "./schemas.ts";

export type { Expense, ExpenseSummary } from "../db/expenses.ts";

export interface ExpenseView extends repo.Expense {
  /** The acting user created it, so may edit or delete it. */
  canEdit: boolean;
}

export interface ExpenseSummaryView extends repo.ExpenseSummary {
  canEdit: boolean;
}

export interface ExpensePreview {
  subtotalCents: Cents;
  totalCents: Cents;
  /** Each member's share; sums to totalCents. */
  shares: Amounts;
  payers: Amounts;
}

/** Validate input against the group and compute shares; throws a 400 explaining the first problems. */
function build(
  ctx: Ctx,
  groupId: number,
  raw: ExpenseInput,
  old?: repo.Expense,
): repo.ExpenseWrite {
  const input = parse(ExpenseInput, raw);
  const allowed = new Set([
    ...groupMembers(ctx.db, groupId).map((m) => m.id),
    ...Object.keys(old?.payers ?? {}).map(Number),
    ...Object.keys(old?.shares ?? {}).map(Number),
  ]);
  const mentioned = [
    ...input.items.flatMap((it) => Object.keys(it.split)),
    ...Object.keys(input.payers),
  ].map(Number);
  if (mentioned.some((m) => !allowed.has(m)))
    throw invalid("Everyone on an expense must be in the group");
  const modes = {} as Adjustments;
  for (const [kind, label] of [
    ["tax", "Tax"],
    ["tip", "Tip"],
    ["discount", "Discount"],
  ] as const) {
    const mode = input[`${kind}Mode`];
    const value =
      input[`${kind}Value`] ??
      (mode === "amount" ? input[`${kind}Cents`] : undefined);
    if (value === undefined) throw invalid(`${label}: give the percent`);
    if (mode === "percent" && value > 100)
      throw invalid(`${label} can't be more than 100%`);
    if (mode === "amount" && !Number.isInteger(value))
      throw invalid(`${label} must be whole cents`);
    modes[`${kind}Mode`] = mode;
    modes[`${kind}Value`] = value;
  }
  const amounts = {
    ...input,
    ...modes,
    ...adjustmentCents(input.items, modes),
  };
  // Leftover cents: the creator (kept on edits), unless told otherwise.
  const creator =
    input.oddCentsTo ??
    (old ? memberForUser(ctx.db, old.createdBy)?.id : ctx.user.memberId);
  const split = computeSplit({
    ...amounts,
    seed: splitSeed(input.date, input.title),
    creator,
  });
  const errors = [
    ...split.errors,
    ...(split.errors.length ? [] : payerErrors(input.payers, split.totalCents)),
  ];
  if (errors.length) throw invalid(errors.join("; "));
  return {
    ...amounts,
    receiptPath:
      input.receiptPath === undefined
        ? (old?.receiptPath ?? null)
        : input.receiptPath,
    recurringId:
      input.recurringId === undefined
        ? (old?.recurringId ?? null)
        : input.recurringId,
    groupId,
    totalCents: split.totalCents,
    shares: split.shares,
  };
}

/** Compute an expense's shares without saving (for dry runs). Same validation as create. */
export function previewExpense(
  ctx: Ctx,
  groupId: number,
  input: ExpenseInput,
): ExpensePreview {
  const group = requireGroup(ctx, parse(id, groupId));
  const e = build(ctx, group.id, input);
  return {
    subtotalCents: e.totalCents - e.taxCents - e.tipCents + e.discountCents,
    totalCents: e.totalCents,
    shares: e.shares,
    payers: e.payers,
  };
}

/** Add an expense to a group. Any member may. `summary` overrides the activity feed wording. */
export function createExpense(
  ctx: Ctx,
  groupId: number,
  input: ExpenseInput,
  summary?: string,
): ExpenseView {
  const group = requireGroup(ctx, parse(id, groupId));
  const e = build(ctx, group.id, input);
  const expenseId = transaction(ctx.db, () => {
    const expenseId = repo.insertExpense(ctx.db, e, ctx.user.id);
    insertAudit(ctx.db, {
      groupId: group.id,
      userId: ctx.user.id,
      action: "create",
      entity: "expense",
      entityId: expenseId,
      summary: summary ?? `added "${e.title}" (${formatCents(e.totalCents)})`,
    });
    return expenseId;
  });
  return getExpense(ctx, expenseId);
}

/** Whoever added an expense or paid any of it may edit or delete it. */
export function mayEdit(ctx: Ctx, e: repo.ExpenseSummary): boolean {
  return e.createdBy === ctx.user.id || (e.payers[ctx.user.memberId] ?? 0) > 0;
}

/** The expense if the acting user is in its group; 404 otherwise. */
export function requireExpense(ctx: Ctx, expenseId: number): repo.Expense {
  const e = repo.getExpense(ctx.db, parse(id, expenseId));
  if (!e) throw notFound("Expense");
  requireGroup(ctx, e.groupId);
  return e;
}

export function requireOwnExpense(
  ctx: Ctx,
  expenseId: number,
  action: string,
): repo.Expense {
  const e = requireExpense(ctx, expenseId);
  if (!mayEdit(ctx, e))
    throw forbidden(
      `Only the person who added this expense or someone who paid it can ${action} it`,
    );
  return e;
}

export function getExpense(ctx: Ctx, expenseId: number): ExpenseView {
  const e = requireExpense(ctx, expenseId);
  return { ...e, canEdit: mayEdit(ctx, e) };
}

/** Replace an expense. Creator or a payer only. People already on it stay allowed even if they left the group. */
export function updateExpense(
  ctx: Ctx,
  expenseId: number,
  input: ExpenseInput,
): ExpenseView {
  const old = requireOwnExpense(ctx, expenseId, "edit");
  const e = build(ctx, old.groupId, input, old);
  transaction(ctx.db, () => {
    repo.updateExpense(ctx.db, old.id, e);
    insertAudit(ctx.db, {
      groupId: old.groupId,
      userId: ctx.user.id,
      action: "update",
      entity: "expense",
      entityId: old.id,
      summary: `edited "${e.title}" (${formatCents(e.totalCents)})`,
    });
  });
  return getExpense(ctx, old.id);
}

/** Delete an expense. Creator or a payer only. */
export function deleteExpense(ctx: Ctx, expenseId: number): void {
  const e = requireOwnExpense(ctx, expenseId, "delete");
  transaction(ctx.db, () => {
    repo.deleteExpense(ctx.db, e.id, ctx.user.id);
    // A billed recurring month becomes billable again.
    if (e.recurringId) releaseMonth(ctx.db, e.recurringId, monthOf(e.date));
    insertAudit(ctx.db, {
      groupId: e.groupId,
      userId: ctx.user.id,
      action: "delete",
      entity: "expense",
      entityId: e.id,
      summary: `deleted "${e.title}" (${formatCents(e.totalCents)})`,
    });
  });
}

/**
 * Undo a delete within 7 days: the same row comes back (id, creator, shares,
 * receipt, recurring link). Whoever could delete it may. A recurring bill
 * takes its month back, or 409s if that month was billed again since.
 */
export function restoreExpense(ctx: Ctx, expenseId: number): ExpenseView {
  const e = repo.getExpense(ctx.db, parse(id, expenseId), true);
  if (!e) throw notFound("Expense");
  requireGroup(ctx, e.groupId);
  requireRestorable("expense", e.deletedAt);
  if (!mayEdit(ctx, e))
    throw forbidden(
      "Only the person who added this expense or someone who paid it can restore it",
    );
  transaction(ctx.db, () => {
    if (e.recurringId) {
      const month = monthOf(e.date);
      const again = repo
        .listExpenses(ctx.db, [e.groupId])
        .find(
          (x) => x.recurringId === e.recurringId && monthOf(x.date) === month,
        );
      if (again)
        throw new ServiceError(
          409,
          `"${e.title}" was billed again for ${monthName(month)}; delete that one first`,
          { existingExpenseId: again.id },
        );
      markBilled(ctx.db, e.recurringId, month);
    }
    repo.restoreExpense(ctx.db, e.id);
    insertAudit(ctx.db, {
      groupId: e.groupId,
      userId: ctx.user.id,
      action: "restore",
      entity: "expense",
      entityId: e.id,
      summary: `restored "${e.title}" (${formatCents(e.totalCents)})`,
    });
  });
  return getExpense(ctx, e.id);
}

/** A group's expenses, newest first, with payers and shares (no items). */
export function listExpenses(ctx: Ctx, groupId: number): ExpenseSummaryView[] {
  const group = requireGroup(ctx, parse(id, groupId));
  return repo
    .listExpenses(ctx.db, [group.id])
    .map((e) => ({ ...e, canEdit: mayEdit(ctx, e) }));
}
