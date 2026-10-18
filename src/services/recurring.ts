import { z } from "zod";
import { insertAudit } from "../db/audit.ts";
import type { Db } from "../db/connection.ts";
import { getGroup, groupMembers } from "../db/groups.ts";
import * as repo from "../db/recurring.ts";
import { memberForUser } from "../db/members.ts";
import { transaction } from "../db/transaction.ts";
import { getUser } from "../db/users.ts";
import { formatCents } from "../domain/money.ts";
import {
  billDate,
  isBilled,
  monthOf,
  nextMonth,
  notStarted,
  recurringStatus,
  todayLocal,
  type RecurringStatus,
} from "../domain/recurring.ts";
import { requireGroup, type Ctx } from "./context.ts";
import { forbidden, invalid, notFound, ServiceError } from "./errors.ts";
import { createExpense } from "./expenses.ts";
import { listExpenses } from "../db/expenses.ts";
import { parse } from "./parse.ts";
import { id } from "./schemas.ts";

export type { Recurring } from "../db/recurring.ts";

export const RecurringInput = z.object({
  title: z.string().trim().max(200).min(1, "Give the bill a title"),
  dayOfMonth: z
    .number()
    .int()
    .min(1, "Pick a day from 1 to 28")
    .max(28, "Pick a day from 1 to 28"),
  /** Fixed every month; bills that change each month are regular expenses. */
  amountCents: z
    .number({ error: "Enter the monthly amount" })
    .int("Amounts must be whole cents")
    .positive("The amount must be more than $0.00"),
  /** member id -> weight. */
  split: z
    .record(
      z.string().regex(/^\d+$/, "Keys must be member ids"),
      z.number().min(0),
    )
    .refine(
      (s) => Object.values(s).some((w) => w > 0),
      "Split it between at least one person",
    ),
  payerMemberId: id,
  paused: z.boolean().default(false),
});
export const BillInput = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Months must look like 2026-01")
    .optional(),
  /** Bill even though a matching expense already exists that month. */
  confirmDuplicate: z.boolean().default(false),
});

export type RecurringInput = z.input<typeof RecurringInput> & {
  /** Also bill this month when its day has already passed (default: start next month). */
  billThisMonth?: boolean;
};
export type RecurringPatch = Partial<RecurringInput>;
export type BillInput = z.input<typeof BillInput>;

export interface RecurringView extends repo.Recurring {
  status: RecurringStatus;
  /** This month isn't billed yet, so "bill now" works. */
  canBillNow: boolean;
  /** Set when the template was created with this month's bill: the expense it made. */
  expenseId?: number;
  /** The acting user created the template or the group, so may edit or delete it. */
  canEdit: boolean;
}

function view(ctx: Ctx, t: repo.Recurring, today: string): RecurringView {
  return {
    ...t,
    status: recurringStatus(t, today),
    canBillNow:
      !isBilled(t.lastMonth, monthOf(today)) &&
      !notStarted(t.startsMonth, monthOf(today)),
    canEdit:
      t.createdBy === ctx.user.id ||
      getGroup(ctx.db, t.groupId)?.createdBy === ctx.user.id,
  };
}

function build(ctx: Ctx, groupId: number, raw: unknown): repo.RecurringWrite {
  const r = parse(RecurringInput, raw);
  const members = new Set(groupMembers(ctx.db, groupId).map((m) => m.id));
  const split = Object.fromEntries(
    Object.entries(r.split)
      .filter(([, w]) => w > 0)
      .map(([m, w]) => [Number(m), w]),
  );
  if (
    !members.has(r.payerMemberId) ||
    Object.keys(split).some((m) => !members.has(Number(m)))
  )
    throw invalid("Everyone on a recurring bill must be in the group");
  return { ...r, split, groupId };
}

function audit(
  ctx: Ctx,
  t: { groupId: number; title: string },
  action: "create" | "update" | "delete",
  entityId: number,
  summary: string,
): void {
  insertAudit(ctx.db, {
    groupId: t.groupId,
    userId: ctx.user.id,
    action,
    entity: "recurring",
    entityId,
    summary,
  });
}

function requireRecurring(ctx: Ctx, recurringId: number): repo.Recurring {
  const t = repo.getRecurring(ctx.db, parse(id, recurringId));
  if (!t) throw notFound("Recurring bill");
  requireGroup(ctx, t.groupId);
  return t;
}

function requireEditable(
  ctx: Ctx,
  recurringId: number,
  action: string,
): repo.Recurring {
  const t = requireRecurring(ctx, recurringId);
  if (!view(ctx, t, todayLocal()).canEdit)
    throw forbidden(
      `Only the person who added this recurring bill or the group's creator can ${action} it`,
    );
  return t;
}

export function listRecurring(
  ctx: Ctx,
  groupId: number,
  today = todayLocal(),
): RecurringView[] {
  const group = requireGroup(ctx, parse(id, groupId));
  return repo.listRecurring(ctx.db, group.id).map((t) => view(ctx, t, today));
}

export function getRecurring(
  ctx: Ctx,
  recurringId: number,
  today = todayLocal(),
): RecurringView {
  return view(ctx, requireRecurring(ctx, recurringId), today);
}

const dayOf = (date: string) => Number(date.slice(8, 10));

/** Add a recurring bill to a group. Any member may. */
export function createRecurring(
  ctx: Ctx,
  groupId: number,
  input: RecurringInput,
  today = todayLocal(),
): RecurringView {
  const group = requireGroup(ctx, parse(id, groupId));
  const r = build(ctx, group.id, input);
  const month = monthOf(today);
  // A day that already passed starts next month, unless asked to bill this one now.
  const startsMonth =
    input.billThisMonth || dayOf(today) <= r.dayOfMonth
      ? month
      : nextMonth(month);
  return transaction(ctx.db, () => {
    const recurringId = repo.insertRecurring(
      ctx.db,
      r,
      ctx.user.id,
      startsMonth,
    );
    audit(
      ctx,
      r,
      "create",
      recurringId,
      `added the recurring bill "${r.title}"`,
    );
    const billed = input.billThisMonth
      ? billRecurring(ctx, recurringId, {}, today)
      : undefined;
    return { ...getRecurring(ctx, recurringId, today), ...billed };
  });
}

/** Change some fields (including `paused`). Template or group creator only. */
export function updateRecurring(
  ctx: Ctx,
  recurringId: number,
  patch: RecurringPatch,
): RecurringView {
  const t = requireEditable(ctx, recurringId, "edit");
  const r = build(ctx, t.groupId, { ...t, ...patch });
  transaction(ctx.db, () => {
    repo.updateRecurring(ctx.db, t.id, r);
    const what =
      r.paused === t.paused ? "edited" : r.paused ? "paused" : "resumed";
    audit(ctx, r, "update", t.id, `${what} the recurring bill "${r.title}"`);
  });
  return getRecurring(ctx, t.id);
}

/** Delete a template; expenses it already billed stay. Template or group creator only. */
export function deleteRecurring(ctx: Ctx, recurringId: number): void {
  const t = requireEditable(ctx, recurringId, "delete");
  transaction(ctx.db, () => {
    repo.deleteRecurring(ctx.db, t.id);
    audit(ctx, t, "delete", t.id, `deleted the recurring bill "${t.title}"`);
  });
}

/** "March 2026". */
export const monthName = (month: string) =>
  new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)) - 1,
    1,
  ).toLocaleString("en-US", { month: "long", year: "numeric" });

/**
 * Turn a template into a normal expense for `month` (default this month): one
 * item split by the template's weights, the payer paying all. Any member may.
 * Each month bills once (claimed atomically), always for the template's
 * amount. Dated the template's day, or today when billed before it.
 * A 409 with `existingExpenseId` flags a look-alike expense that month unless
 * `confirmDuplicate` is set.
 */
export function billRecurring(
  ctx: Ctx,
  recurringId: number,
  input: BillInput = {},
  today = todayLocal(),
): { expenseId: number } {
  const t = requireRecurring(ctx, recurringId);
  const b = parse(BillInput, input);
  const month = b.month ?? monthOf(today);
  if (month > monthOf(today))
    throw invalid(`${monthName(month)} hasn't started yet`);
  const billed = () =>
    invalid(`"${t.title}" is already billed for ${monthName(month)}`);
  if (notStarted(t.startsMonth, month))
    throw invalid(`"${t.title}" starts in ${monthName(t.startsMonth!)}`);
  if (isBilled(t.lastMonth, month)) throw billed();
  const cents = t.amountCents;
  const early = month === monthOf(today) && dayOf(today) < t.dayOfMonth;
  return transaction(ctx.db, () => {
    const dup = b.confirmDuplicate
      ? undefined
      : listExpenses(ctx.db, [t.groupId]).find(
          (e) =>
            monthOf(e.date) === month &&
            e.totalCents === cents &&
            e.title
              .trim()
              .toLowerCase()
              .startsWith(t.title.trim().toLowerCase()),
        );
    if (dup)
      throw new ServiceError(
        409,
        `"${dup.title}" (${formatCents(cents)}, ${dup.date}) is already in the group for ${monthName(month)}; bill anyway?`,
        { existingExpenseId: dup.id },
      );
    if (!repo.claimMonth(ctx.db, t.id, month)) throw billed();
    const expense = createExpense(
      ctx,
      t.groupId,
      {
        title: t.title,
        date: early ? today : billDate(month, t.dayOfMonth),
        items: [
          {
            name: t.title,
            quantity: 1,
            unitCents: cents,
            splitType: "shares",
            split: t.split,
          },
        ],
        payers: { [t.payerMemberId]: cents },
        recurringId: t.id,
        oddCentsTo: memberForUser(ctx.db, t.createdBy)?.id,
      },
      `billed "${t.title}" for ${monthName(month)} (${formatCents(cents)})`,
    );
    return { expenseId: expense.id };
  });
}

export interface RecurResult {
  billed: Array<{ recurringId: number; title: string; expenseId: number }>;
  /** Already added by hand this month; the month is marked billed without a second expense. */
  skipped: Array<{ recurringId: number; title: string; expenseId: number }>;
  failed: Array<{ recurringId: number; title: string; error: string }>;
}

/**
 * Bill every unpaused fixed-amount template whose day has come this month and
 * isn't billed yet, acting as the template's creator (or the group's creator
 * if they left). Safe to run any number of times a day.
 */
export function billDue(db: Db, today = todayLocal()): RecurResult {
  const out: RecurResult = { billed: [], skipped: [], failed: [] };
  for (const t of repo.listRecurring(db)) {
    if (t.paused) continue;
    if (recurringStatus(t, today) !== "due") continue;
    // A deleted bill's month waits for someone to bill it by hand.
    if (t.manualMonth === monthOf(today)) continue;
    const actors = [t.createdBy, getGroup(db, t.groupId)?.createdBy];
    let error = "Nobody in the group can bill it";
    for (const userId of new Set(actors)) {
      const user = userId === undefined ? undefined : getUser(db, userId);
      if (!user) continue;
      try {
        const { expenseId } = billRecurring({ db, user }, t.id, {}, today);
        out.billed.push({ recurringId: t.id, title: t.title, expenseId });
        error = "";
        break;
      } catch (err) {
        if (!(err instanceof ServiceError)) throw err;
        const existing = err.data.existingExpenseId;
        if (typeof existing === "number") {
          repo.claimMonth(db, t.id, monthOf(today));
          out.skipped.push({
            recurringId: t.id,
            title: t.title,
            expenseId: existing,
          });
          error = "";
          break;
        }
        error = err.message;
      }
    }
    if (error) out.failed.push({ recurringId: t.id, title: t.title, error });
  }
  return out;
}
