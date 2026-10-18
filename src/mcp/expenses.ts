import { z } from "zod";
import { formatCents } from "../domain/money.ts";
import { todayLocal } from "../domain/recurring.ts";
import { adjustmentCents, computeSplit } from "../domain/split.ts";
import { SPLIT_TYPES } from "../domain/types.ts";
import { netSentence } from "../domain/words.ts";
import type { Ctx } from "../services/context.ts";
import { invalid } from "../services/errors.ts";
import { groupBalances } from "../services/balances.ts";
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  previewExpense,
  restoreExpense,
  type ExpenseSummaryView,
} from "../services/expenses.ts";
import { receiptPathFor } from "../services/receipts.ts";
import type { ExpenseInput } from "../services/schemas.ts";
import {
  centsArg,
  groupArg,
  groupPeople,
  handle,
  personArg,
  resolveGroup,
  type Register,
} from "./tools.ts";

const splitArgs = {
  split_among: z
    .array(personArg)
    .optional()
    .describe("People sharing equally; default everyone in the group"),
  split_type: z
    .enum(SPLIT_TYPES)
    .optional()
    .describe(
      "How `split` values are read: percent (sum 100), exact (cents, sum to the line), shares (weights). Default equal, or shares when `split` is given",
    ),
  split: z
    .record(personArg, z.number().nonnegative())
    .optional()
    .describe("Person -> percent, exact cents or weight, per split_type"),
};

const percentArg = z.number().min(0).max(100);

const AddExpense = {
  group: groupArg,
  title: z.string(),
  date: z.string().optional().describe("YYYY-MM-DD, default today"),
  amount_cents: centsArg
    .optional()
    .describe(
      "Simple expense: the amount before tax/tip/discount, in integer cents. Omit when giving items",
    ),
  ...splitArgs,
  items: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.number().positive().optional().describe("Default 1"),
        unit_cents: centsArg.describe("Price of one unit in integer cents"),
        ...splitArgs,
      }),
    )
    .optional()
    .describe(
      "Itemized expense (e.g. from scan_receipt_file); each item splits on its own",
    ),
  tax_cents: centsArg.optional(),
  tax_percent: percentArg
    .optional()
    .describe("Tax as a percent of the item subtotal, instead of tax_cents"),
  tip_cents: centsArg.optional().describe("Tip, service charge or fees"),
  tip_percent: percentArg
    .optional()
    .describe("Tip as a percent of the item subtotal, instead of tip_cents"),
  discount_cents: centsArg.optional(),
  discount_percent: percentArg
    .optional()
    .describe(
      "Discount as a percent of the item subtotal, instead of discount_cents",
    ),
  paid_by: personArg
    .optional()
    .describe("Who paid the whole total; default you"),
  payers: z
    .record(personArg, centsArg)
    .optional()
    .describe("Several payers: person -> cents paid, summing to the total"),
  category: z.string().optional(),
  notes: z.string().optional(),
  receipt_id: z
    .number()
    .int()
    .optional()
    .describe("receiptId from scan_receipt_file, to attach the photo"),
  dry_run: z
    .boolean()
    .describe(
      "true: compute and return each person's share and the balance changes without saving. Always do this first",
    ),
};

type People = ReturnType<typeof groupPeople>;
type SplitArgs = {
  split_among?: string[];
  split_type?: (typeof SPLIT_TYPES)[number];
  split?: Record<string, number>;
};

function itemSplit(p: People, a: SplitArgs) {
  if (a.split) {
    if (a.split_among)
      throw invalid("Give either split_among or split, not both");
    return { splitType: a.split_type ?? "shares", split: p.byId(a.split) };
  }
  if (a.split_type && a.split_type !== "equal")
    throw invalid(`split_type ${a.split_type} needs split values`);
  const among = a.split_among?.map((r) => p.person(r)) ?? p.members;
  return {
    splitType: "equal" as const,
    split: Object.fromEntries(among.map((m) => [String(m.id), 1])),
  };
}

/** `{ taxMode, taxValue }` from `tax_cents` or `tax_percent`. */
function mode<K extends "tax" | "tip" | "discount">(
  kind: K,
  cents: number | undefined,
  percent: number | undefined,
) {
  if (cents !== undefined && percent !== undefined)
    throw invalid(`Give ${kind}_cents or ${kind}_percent, not both`);
  return {
    [`${kind}Mode`]: percent === undefined ? "amount" : "percent",
    [`${kind}Value`]: percent ?? cents ?? 0,
  } as Record<`${K}Mode`, "amount" | "percent"> & Record<`${K}Value`, number>;
}

type AddArgs = z.infer<z.ZodObject<typeof AddExpense>>;

function toInput(ctx: Ctx, groupId: number, a: AddArgs): ExpenseInput {
  const p = groupPeople(ctx, groupId);
  if ((a.amount_cents === undefined) === (a.items === undefined))
    throw invalid("Give either amount_cents or items");
  const items = a.items
    ? a.items.map((it) => ({
        name: it.name,
        quantity: it.quantity ?? 1,
        unitCents: it.unit_cents,
        ...itemSplit(p, it),
      }))
    : [
        {
          name: a.title,
          quantity: 1,
          unitCents: a.amount_cents!,
          ...itemSplit(p, a),
        },
      ];
  const base = {
    title: a.title,
    date: a.date ?? todayLocal(),
    items,
    ...mode("tax", a.tax_cents, a.tax_percent),
    ...mode("tip", a.tip_cents, a.tip_percent),
    ...mode("discount", a.discount_cents, a.discount_percent),
    category: a.category ?? null,
    notes: a.notes ?? "",
  };
  if (a.payers && a.paid_by)
    throw invalid("Give either paid_by or payers, not both");
  const payers = a.payers
    ? p.byId(a.payers)
    : {
        [p.person(a.paid_by ?? "me").id]: computeSplit({
          ...base,
          ...adjustmentCents(base.items, base),
        }).totalCents,
      };
  return {
    ...base,
    payers,
    ...receiptPathFor(ctx, groupId, a.receipt_id),
  };
}

/** An expense with names instead of member ids. */
export function expenseOut(ctx: Ctx, e: ExpenseSummaryView) {
  const p = groupPeople(ctx, e.groupId);
  return {
    id: e.id,
    groupId: e.groupId,
    title: e.title,
    date: e.date,
    total: formatCents(e.totalCents),
    totalCents: e.totalCents,
    taxCents: e.taxCents,
    ...(e.taxMode === "percent" ? { taxPercent: e.taxValue } : {}),
    ...(e.tipMode === "percent" ? { tipPercent: e.tipValue } : {}),
    ...(e.discountMode === "percent"
      ? { discountPercent: e.discountValue }
      : {}),
    tipCents: e.tipCents,
    discountCents: e.discountCents,
    category: e.category,
    notes: e.notes,
    paidBy: p.named(e.payers),
    shares: p.named(e.shares),
    ...("items" in e
      ? {
          items: (e.items as ExpenseInput["items"]).map((it) => ({
            name: it.name,
            quantity: it.quantity,
            unitCents: it.unitCents,
            splitType: it.splitType,
            split: Object.fromEntries(
              Object.entries(it.split).map(([id, v]) => [
                p.names.get(Number(id)) ?? id,
                v,
              ]),
            ),
          })),
        }
      : {}),
    recurringId: e.recurringId,
    receiptId: e.receiptId,
    youCanEdit: e.canEdit,
  };
}

export const registerExpenses: Register = (server, ctx) => {
  server.registerTool(
    "add_expense",
    {
      description: `Add a bill to a group, simple (amount_cents) or itemized (items). People are referenced by name.
ALWAYS call with dry_run: true first, show the user each person's share and who ends up owing whom, and only call again with dry_run: false after the user confirms.`,
      inputSchema: AddExpense,
    },
    (a) =>
      handle(() => {
        const groupId = resolveGroup(ctx, a.group);
        const input = toInput(ctx, groupId, a);
        if (!a.dry_run)
          return {
            saved: true,
            expense: expenseOut(ctx, createExpense(ctx, groupId, input)),
          };
        const preview = previewExpense(ctx, groupId, input);
        const p = groupPeople(ctx, groupId);
        const me = ctx.user.memberId;
        const before = new Map(
          groupBalances(ctx, groupId).members.map((m) => [m.memberId, m.cents]),
        );
        const ids = new Set(
          [...Object.keys(preview.shares), ...Object.keys(preview.payers)].map(
            Number,
          ),
        );
        return {
          saved: false,
          note: "Preview only, nothing was saved. Show this to the user; save with dry_run: false once they confirm.",
          title: input.title,
          date: input.date,
          subtotal: formatCents(preview.subtotalCents),
          total: formatCents(preview.totalCents),
          totalCents: preview.totalCents,
          paidBy: p.named(preview.payers),
          shares: p.named(preview.shares),
          balances: [...ids].map((id) => {
            const effect =
              (preview.payers[id] ?? 0) - (preview.shares[id] ?? 0);
            const after = (before.get(id) ?? 0) + effect;
            return {
              memberId: id,
              name: p.names.get(id) ?? "Someone",
              effectCents: effect,
              afterCents: after,
              after: netSentence(p.names, me, id, after),
            };
          }),
        };
      }),
  );

  server.registerTool(
    "get_expense",
    {
      description: "One expense with its items, payers and shares.",
      inputSchema: { expense_id: z.number().int() },
      annotations: { readOnlyHint: true },
    },
    ({ expense_id }) =>
      handle(() => ({ expense: expenseOut(ctx, getExpense(ctx, expense_id)) })),
  );

  server.registerTool(
    "list_expenses",
    {
      description: "A group's expenses, newest first.",
      inputSchema: {
        group: groupArg,
        limit: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe("Default 20"),
      },
      annotations: { readOnlyHint: true },
    },
    ({ group, limit }) =>
      handle(() => ({
        expenses: listExpenses(ctx, resolveGroup(ctx, group))
          .slice(0, limit ?? 20)
          .map((e) => expenseOut(ctx, e)),
      })),
  );

  server.registerTool(
    "restore_expense",
    {
      description:
        "Undo delete_expense within 7 days: the same expense comes back with its id, shares, receipt and recurring link.",
      inputSchema: { expense_id: z.number().int() },
    },
    ({ expense_id }) =>
      handle(() => ({
        restored: true,
        expense: expenseOut(ctx, restoreExpense(ctx, expense_id)),
      })),
  );

  server.registerTool(
    "delete_expense",
    {
      description:
        "Delete an expense you added or paid. Confirm with the user first (show title, date and amount). It can be undone with restore_expense for 7 days.",
      inputSchema: { expense_id: z.number().int() },
      annotations: { destructiveHint: true },
    },
    ({ expense_id }) =>
      handle(() => {
        deleteExpense(ctx, expense_id);
        return { deleted: expense_id };
      }),
  );
};
