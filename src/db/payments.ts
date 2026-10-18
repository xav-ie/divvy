import type { Cents, LocalDate } from "../domain/types.ts";
import type { Db } from "./connection.ts";
import { all, insertedId, one, placeholders, run } from "./rows.ts";

export interface Payment {
  id: number;
  groupId: number;
  fromMember: number;
  toMember: number;
  cents: Cents;
  date: LocalDate;
  note: string;
  /** User id of the creator. */
  createdBy: number;
  created: string;
  /** Set while deleted (restorable for 7 days); deleted payments never appear in reads. */
  deletedAt: string | null;
}

const SELECT = `SELECT id, group_id AS groupId, from_member AS fromMember, to_member AS toMember, cents, date, note,
  created_by AS createdBy, created, deleted_at AS deletedAt FROM payments`;

export function insertPayment(
  db: Db,
  p: Omit<Payment, "id" | "created" | "deletedAt">,
): number {
  return insertedId(
    run(
      db,
      "INSERT INTO payments (group_id, from_member, to_member, cents, date, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      p.groupId,
      p.fromMember,
      p.toMember,
      p.cents,
      p.date,
      p.note,
      p.createdBy,
    ),
  );
}

/** A live payment; `includeDeleted` also finds soft-deleted ones (for restore). */
export function getPayment(
  db: Db,
  id: number,
  includeDeleted = false,
): Payment | undefined {
  return one<Payment>(
    db,
    `${SELECT} WHERE id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`,
    id,
  );
}

/** Soft delete: hidden from every read until restored. */
export function deletePayment(db: Db, id: number, userId: number): void {
  run(
    db,
    "UPDATE payments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), deleted_by = ? WHERE id = ?",
    userId,
    id,
  );
}

export function restorePayment(db: Db, id: number): void {
  run(
    db,
    "UPDATE payments SET deleted_at = NULL, deleted_by = NULL WHERE id = ?",
    id,
  );
}

/** Payments in these groups, newest first. */
export function listPayments(db: Db, groupIds: number[]): Payment[] {
  if (groupIds.length === 0) return [];
  return all<Payment>(
    db,
    `${SELECT} WHERE group_id IN (${placeholders(groupIds.length)}) AND deleted_at IS NULL ORDER BY date DESC, created DESC, id DESC`,
    ...groupIds,
  );
}
