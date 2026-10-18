import type {
  Adjustments,
  Amounts,
  Cents,
  ExpenseItem,
  LocalDate,
  SplitType,
} from "../domain/types.ts";
import type { Db } from "./connection.ts";
import { all, insertedId, one, placeholders, run } from "./rows.ts";

export interface ExpenseRecord extends Adjustments {
  id: number;
  groupId: number;
  title: string;
  date: LocalDate;
  totalCents: Cents;
  taxCents: Cents;
  tipCents: Cents;
  discountCents: Cents;
  category: string | null;
  notes: string;
  /** User id of the creator. */
  createdBy: number;
  created: string;
  updated: string;
  recurringId: number | null;
  receiptPath: string | null;
  /** The linked receipt image, served at /api/receipts/:id. */
  receiptId: number | null;
  /** Set while deleted (restorable for 7 days); deleted expenses never appear in reads. */
  deletedAt: string | null;
}

/** An expense with who paid and each member's share. */
export interface ExpenseSummary extends ExpenseRecord {
  payers: Amounts;
  shares: Amounts;
}

export interface Expense extends ExpenseSummary {
  items: ExpenseItem[];
}

/** Everything stored for an expense; shares are already computed by the domain. */
export type ExpenseWrite = Omit<
  Expense,
  "id" | "createdBy" | "created" | "updated" | "receiptId" | "deletedAt"
>;

const SELECT = `SELECT id, group_id AS groupId, title, date, total_cents AS totalCents, tax_cents AS taxCents,
  tip_cents AS tipCents, discount_cents AS discountCents, category, notes, created_by AS createdBy, created, updated,
  recurring_id AS recurringId, receipt_path AS receiptPath, tax_mode AS taxMode, tax_value AS taxValue,
  tip_mode AS tipMode, tip_value AS tipValue, discount_mode AS discountMode, discount_value AS discountValue,
  (SELECT r.id FROM receipts r WHERE r.path = expenses.receipt_path) AS receiptId, deleted_at AS deletedAt FROM expenses`;

const modeParams = (e: Adjustments) =>
  [
    e.taxMode,
    e.taxValue,
    e.tipMode,
    e.tipValue,
    e.discountMode,
    e.discountValue,
  ] as const;

function writeChildren(db: Db, id: number, e: ExpenseWrite): void {
  for (const table of ["expense_items", "expense_payers", "expense_shares"]) {
    run(db, `DELETE FROM ${table} WHERE expense_id = ?`, id);
  }
  e.items.forEach((it, i) =>
    run(
      db,
      "INSERT INTO expense_items (expense_id, position, name, quantity, unit_cents, split_type, split) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      i,
      it.name,
      it.quantity,
      it.unitCents,
      it.splitType,
      JSON.stringify(it.split),
    ),
  );
  for (const [table, amounts] of [
    ["expense_payers", e.payers],
    ["expense_shares", e.shares],
  ] as const) {
    for (const [member, cents] of Object.entries(amounts))
      if (cents)
        run(
          db,
          `INSERT INTO ${table} (expense_id, member_id, cents) VALUES (?, ?, ?)`,
          id,
          Number(member),
          cents,
        );
  }
}

/** Insert an expense with its items, payers and shares. Run inside a transaction. */
export function insertExpense(
  db: Db,
  e: ExpenseWrite,
  createdBy: number,
): number {
  const id = insertedId(
    run(
      db,
      `INSERT INTO expenses (group_id, title, date, total_cents, tax_cents, tip_cents, discount_cents, category, notes,
         created_by, recurring_id, receipt_path, tax_mode, tax_value, tip_mode, tip_value, discount_mode, discount_value)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      e.groupId,
      e.title,
      e.date,
      e.totalCents,
      e.taxCents,
      e.tipCents,
      e.discountCents,
      e.category,
      e.notes,
      createdBy,
      e.recurringId,
      e.receiptPath,
      ...modeParams(e),
    ),
  );
  writeChildren(db, id, e);
  return id;
}

/** Replace an expense's fields and children in place. Run inside a transaction. */
export function updateExpense(db: Db, id: number, e: ExpenseWrite): void {
  run(
    db,
    `UPDATE expenses SET title = ?, date = ?, total_cents = ?, tax_cents = ?, tip_cents = ?, discount_cents = ?, category = ?,
     notes = ?, recurring_id = ?, receipt_path = ?, tax_mode = ?, tax_value = ?, tip_mode = ?, tip_value = ?,
     discount_mode = ?, discount_value = ?, updated = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    e.title,
    e.date,
    e.totalCents,
    e.taxCents,
    e.tipCents,
    e.discountCents,
    e.category,
    e.notes,
    e.recurringId,
    e.receiptPath,
    ...modeParams(e),
    id,
  );
  writeChildren(db, id, e);
}

/** Soft delete: hidden from every read until restored. */
export function deleteExpense(db: Db, id: number, userId: number): void {
  run(
    db,
    "UPDATE expenses SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), deleted_by = ? WHERE id = ?",
    userId,
    id,
  );
}

export function restoreExpense(db: Db, id: number): void {
  run(
    db,
    "UPDATE expenses SET deleted_at = NULL, deleted_by = NULL WHERE id = ?",
    id,
  );
}

function amountsFor(
  db: Db,
  table: "expense_payers" | "expense_shares",
  ids: number[],
): Map<number, Amounts> {
  const out = new Map<number, Amounts>(ids.map((id) => [id, {}]));
  if (ids.length === 0) return out;
  const rows = all<{ expenseId: number; memberId: number; cents: number }>(
    db,
    `SELECT expense_id AS expenseId, member_id AS memberId, cents FROM ${table} WHERE expense_id IN (${placeholders(ids.length)})`,
    ...ids,
  );
  for (const r of rows) out.get(r.expenseId)![r.memberId] = r.cents;
  return out;
}

function withAmounts(db: Db, records: ExpenseRecord[]): ExpenseSummary[] {
  const ids = records.map((r) => r.id);
  const payers = amountsFor(db, "expense_payers", ids);
  const shares = amountsFor(db, "expense_shares", ids);
  return records.map((r) => ({
    ...r,
    payers: payers.get(r.id)!,
    shares: shares.get(r.id)!,
  }));
}

/** A live expense; `includeDeleted` also finds soft-deleted ones (for restore). */
export function getExpense(
  db: Db,
  id: number,
  includeDeleted = false,
): Expense | undefined {
  const record = one<ExpenseRecord>(
    db,
    `${SELECT} WHERE id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`,
    id,
  );
  if (!record) return undefined;
  const items = all<{
    name: string;
    quantity: number;
    unitCents: number;
    splitType: SplitType;
    split: string;
  }>(
    db,
    "SELECT name, quantity, unit_cents AS unitCents, split_type AS splitType, split FROM expense_items WHERE expense_id = ? ORDER BY position",
    id,
  ).map((r) => ({ ...r, split: JSON.parse(r.split) as ExpenseItem["split"] }));
  return { ...withAmounts(db, [record])[0]!, items };
}

/** Expenses in these groups, newest first, with payers and shares (no items). */
export function listExpenses(db: Db, groupIds: number[]): ExpenseSummary[] {
  if (groupIds.length === 0) return [];
  const records = all<ExpenseRecord>(
    db,
    `${SELECT} WHERE group_id IN (${placeholders(groupIds.length)}) AND deleted_at IS NULL ORDER BY date DESC, created DESC, id DESC`,
    ...groupIds,
  );
  return withAmounts(db, records);
}
