import { z } from "zod";
import { formatCents } from "../domain/money.ts";
import {
  billRecurring,
  createRecurring,
  listRecurring,
  type RecurringView,
} from "../services/recurring.ts";
import type { Ctx } from "../services/context.ts";
import {
  centsArg,
  groupArg,
  groupPeople,
  handle,
  personArg,
  resolveGroup,
  type Register,
} from "./tools.ts";

function recurringOut(ctx: Ctx, t: RecurringView) {
  const p = groupPeople(ctx, t.groupId);
  return {
    id: t.id,
    title: t.title,
    dayOfMonth: t.dayOfMonth,
    amount: formatCents(t.amountCents),
    amountCents: t.amountCents,
    paidBy: p.names.get(t.payerMemberId) ?? "Someone",
    weights: Object.fromEntries(
      Object.entries(t.split).map(([id, w]) => [
        p.names.get(Number(id)) ?? id,
        w,
      ]),
    ),
    status: t.status,
    canBillNow: t.canBillNow,
    lastMonth: t.lastMonth,
    startsMonth: t.startsMonth,
    paused: t.paused,
  };
}

export const registerRecurring: Register = (server, ctx) => {
  server.registerTool(
    "list_recurring",
    {
      description:
        'A group\'s recurring bills (fixed amounts, billed automatically on their day). status: "billed" this month, "due" (its day has come and it will bill automatically), or "upcoming".',
      inputSchema: { group: groupArg },
      annotations: { readOnlyHint: true },
    },
    ({ group }) =>
      handle(() => ({
        recurring: listRecurring(ctx, resolveGroup(ctx, group)).map((t) =>
          recurringOut(ctx, t),
        ),
      })),
  );

  server.registerTool(
    "add_recurring",
    {
      description:
        "Add a monthly recurring bill with a fixed amount (rent, internet, subscriptions); it bills automatically on its day. Bills that change every month (electric, gas) are not recurring: add them as regular expenses with add_expense. Confirm the details with the user before calling.",
      inputSchema: {
        group: groupArg,
        title: z.string(),
        day_of_month: z.number().int().min(1).max(28),
        bill_this_month: z
          .boolean()
          .optional()
          .describe(
            "Bill this month right away; otherwise a day that already passed starts next month",
          ),
        amount_cents: centsArg.positive().describe("The fixed monthly amount"),
        paid_by: personArg
          .optional()
          .describe("Who pays the bill; default you"),
        split_among: z
          .array(personArg)
          .optional()
          .describe("Equal split; default everyone"),
        weights: z
          .record(personArg, z.number().nonnegative())
          .optional()
          .describe(
            "Unequal split: person -> weight (e.g. 2 and 1 for two thirds and one third)",
          ),
      },
    },
    (a) =>
      handle(() => {
        const groupId = resolveGroup(ctx, a.group);
        const p = groupPeople(ctx, groupId);
        const split = a.weights
          ? p.byId(a.weights)
          : Object.fromEntries(
              (a.split_among?.map((r) => p.person(r)) ?? p.members).map((m) => [
                String(m.id),
                1,
              ]),
            );
        const t = createRecurring(ctx, groupId, {
          title: a.title,
          dayOfMonth: a.day_of_month,
          amountCents: a.amount_cents,
          split,
          payerMemberId: p.person(a.paid_by ?? "me").id,
          billThisMonth: a.bill_this_month,
        });
        return {
          recurring: recurringOut(ctx, t),
          ...(t.expenseId ? { billedExpenseId: t.expenseId } : {}),
        };
      }),
  );

  server.registerTool(
    "bill_recurring",
    {
      description:
        "Create this month's (or an earlier unbilled month's) expense from a recurring bill, for its fixed amount. Normally not needed (bills add themselves on their day); use it when a month's bill was deleted and should be added again. Confirm with the user first.",
      inputSchema: {
        recurring_id: z.number().int(),
        month: z.string().optional().describe("YYYY-MM, default this month"),
      },
    },
    (a) => handle(() => billRecurring(ctx, a.recurring_id, { month: a.month })),
  );
};
