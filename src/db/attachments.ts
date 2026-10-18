import type { Db } from "./connection.ts";
import { all, insertedId, one, run } from "./rows.ts";

export interface Attachment {
  id: number;
  /** null until the expense it was uploaded for is saved. */
  expenseId: number | null;
  /** The expense's group (null while unlinked). */
  groupId: number | null;
  uploadedBy: number;
  uploaderName: string;
  filename: string;
  label: string | null;
  mime: string;
  size: number;
  sha256: string;
  /** Relative to the data dir: `attachments/<uuid>`. */
  path: string;
  created: string;
}

/** Live attachments only: not removed, and not on a deleted expense. */
const SELECT = `SELECT a.id, a.expense_id AS expenseId, e.group_id AS groupId, a.uploaded_by AS uploadedBy,
  u.name AS uploaderName, a.filename, a.label, a.mime, a.size, a.sha256, a.path, a.created
  FROM expense_attachments a JOIN users u ON u.id = a.uploaded_by
  LEFT JOIN expenses e ON e.id = a.expense_id
  WHERE a.deleted_at IS NULL AND (a.expense_id IS NULL OR e.deleted_at IS NULL)`;

export function insertAttachment(
  db: Db,
  a: Omit<Attachment, "id" | "groupId" | "uploaderName" | "created">,
): number {
  return insertedId(
    run(
      db,
      `INSERT INTO expense_attachments (expense_id, uploaded_by, filename, label, mime, size, sha256, path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      a.expenseId,
      a.uploadedBy,
      a.filename,
      a.label,
      a.mime,
      a.size,
      a.sha256,
      a.path,
    ),
  );
}

export function getAttachment(db: Db, id: number): Attachment | undefined {
  return one<Attachment>(db, `${SELECT} AND a.id = ?`, id);
}

/** An expense's attachments, oldest first. */
export function listAttachments(db: Db, expenseId: number): Attachment[] {
  return all<Attachment>(
    db,
    `${SELECT} AND a.expense_id = ? ORDER BY a.created, a.id`,
    expenseId,
  );
}

export function linkAttachment(db: Db, id: number, expenseId: number): void {
  run(
    db,
    "UPDATE expense_attachments SET expense_id = ? WHERE id = ? AND expense_id IS NULL",
    expenseId,
    id,
  );
}

export function removeAttachment(db: Db, id: number): void {
  run(
    db,
    "UPDATE expense_attachments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    id,
  );
}
