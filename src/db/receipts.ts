import type { Db } from "./connection.ts";
import { all, insertedId, one, run } from "./rows.ts";

export interface Receipt {
  id: number;
  /** Relative to the data dir, e.g. `receipts/<uuid>.jpg`. */
  path: string;
  mediaType: string;
  /** User id of the uploader. */
  uploadedBy: number;
  created: string;
}

export function insertReceipt(
  db: Db,
  r: Pick<Receipt, "path" | "mediaType" | "uploadedBy">,
): number {
  return insertedId(
    run(
      db,
      "INSERT INTO receipts (path, media_type, uploaded_by) VALUES (?, ?, ?)",
      r.path,
      r.mediaType,
      r.uploadedBy,
    ),
  );
}

export function getReceipt(db: Db, id: number): Receipt | undefined {
  return one<Receipt>(
    db,
    "SELECT id, path, media_type AS mediaType, uploaded_by AS uploadedBy, created FROM receipts WHERE id = ?",
    id,
  );
}

/** Groups of the live expenses this receipt is linked to. */
export function receiptGroups(db: Db, path: string): number[] {
  return all<{ groupId: number }>(
    db,
    "SELECT DISTINCT group_id AS groupId FROM expenses WHERE receipt_path = ? AND deleted_at IS NULL",
    path,
  ).map((r) => r.groupId);
}
