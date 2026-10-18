import { prevMonth } from "../domain/recurring.ts";
import type { Cents, MemberId } from "../domain/types.ts";
import type { Db } from "./connection.ts";
import { all, insertedId, one, run } from "./rows.ts";

export interface Recurring {
  id: number;
  groupId: number;
  title: string;
  dayOfMonth: number;
  /** The same every month (migration 015 retired amount-less templates). */
  amountCents: Cents;
  /** member id -> weight. */
  split: Record<MemberId, number>;
  payerMemberId: MemberId;
  /** Latest `YYYY-MM` billed. */
  lastMonth: string | null;
  /** First `YYYY-MM` it bills; null means any month. */
  startsMonth: string | null;
  /** A month whose bill was deleted: billable by hand, skipped by `divvy recur`. */
  manualMonth: string | null;
  paused: boolean;
  /** User id of the creator. */
  createdBy: number;
}

export type RecurringWrite = Omit<
  Recurring,
  "id" | "lastMonth" | "startsMonth" | "manualMonth" | "createdBy"
>;

type Row = Omit<Recurring, "split" | "paused"> & {
  split: string;
  paused: number;
};

const SELECT = `SELECT id, group_id AS groupId, title, day_of_month AS dayOfMonth, amount_cents AS amountCents, split,
  payer_member AS payerMemberId, last_month AS lastMonth, starts_month AS startsMonth, manual_month AS manualMonth, paused, created_by AS createdBy FROM recurring`;

const toRecurring = (r: Row): Recurring => ({
  ...r,
  split: JSON.parse(r.split) as Recurring["split"],
  paused: r.paused === 1,
});

export function insertRecurring(
  db: Db,
  r: RecurringWrite,
  createdBy: number,
  startsMonth: string | null = null,
): number {
  return insertedId(
    run(
      db,
      `INSERT INTO recurring (group_id, title, day_of_month, amount_cents, split, payer_member, paused, created_by,
         starts_month) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.groupId,
      r.title,
      r.dayOfMonth,
      r.amountCents,
      JSON.stringify(r.split),
      r.payerMemberId,
      r.paused ? 1 : 0,
      createdBy,
      startsMonth,
    ),
  );
}

export function updateRecurring(db: Db, id: number, r: RecurringWrite): void {
  run(
    db,
    `UPDATE recurring SET title = ?, day_of_month = ?, amount_cents = ?, split = ?, payer_member = ?, paused = ?
     WHERE id = ?`,
    r.title,
    r.dayOfMonth,
    r.amountCents,
    JSON.stringify(r.split),
    r.payerMemberId,
    r.paused ? 1 : 0,
    id,
  );
}

/**
 * Give `month` back for manual billing: if it is the latest billed, the one
 * before becomes the latest and `month` is marked manual so `divvy recur`
 * doesn't bill it again on its own.
 */
export function releaseMonth(db: Db, id: number, month: string): void {
  run(
    db,
    "UPDATE recurring SET last_month = ?, manual_month = ? WHERE id = ? AND last_month = ?",
    prevMonth(month),
    month,
    id,
    month,
  );
}

/** Record `month` as billed, keeping a later latest month. */
export function markBilled(db: Db, id: number, month: string): void {
  run(
    db,
    `UPDATE recurring SET last_month = max(coalesce(last_month, ''), ?),
     manual_month = nullif(manual_month, ?) WHERE id = ?`,
    month,
    month,
    id,
  );
}

/** Mark `month` billed unless it (or a later month) already is; false when someone else got there first. */
export function claimMonth(db: Db, id: number, month: string): boolean {
  const r = run(
    db,
    `UPDATE recurring SET last_month = ?, manual_month = nullif(manual_month, ?)
       WHERE id = ? AND (last_month IS NULL OR last_month < ?)`,
    month,
    month,
    id,
    month,
  );
  return Number(r.changes) === 1;
}

export function deleteRecurring(db: Db, id: number): void {
  run(db, "DELETE FROM recurring WHERE id = ?", id);
}

export function getRecurring(db: Db, id: number): Recurring | undefined {
  const r = one<Row>(db, `${SELECT} WHERE id = ?`, id);
  return r && toRecurring(r);
}

/** One group's templates, or every group's when `groupId` is omitted; by day then title. */
export function listRecurring(db: Db, groupId?: number): Recurring[] {
  const rows =
    groupId === undefined
      ? all<Row>(db, `${SELECT} ORDER BY day_of_month, title, id`)
      : all<Row>(
          db,
          `${SELECT} WHERE group_id = ? ORDER BY day_of_month, title, id`,
          groupId,
        );
  return rows.map(toRecurring);
}
