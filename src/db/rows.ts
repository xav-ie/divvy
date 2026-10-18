import type { Db } from "./connection.ts";

export type Param = string | number | null | ArrayBuffer;

/** Every row: column aliases in the SQL must match `T`'s keys. */
export function all<T>(db: Db, sql: string, ...params: Param[]): T[] {
  return db.sql.exec(sql, ...params).toArray() as T[];
}

/** The first row; undefined when there is none. */
export function one<T>(db: Db, sql: string, ...params: Param[]): T | undefined {
  return all<T>(db, sql, ...params)[0];
}

/** Run a write; `changes` and `lastInsertRowid` as SQLite reports them. */
export function run(
  db: Db,
  sql: string,
  ...params: Param[]
): { changes: number; lastInsertRowid: number } {
  db.sql.exec(sql, ...params).toArray();
  return one(
    db,
    "SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid",
  )!;
}

/** `?, ?, ?` for an IN list. */
export function placeholders(n: number): string {
  return Array(n).fill("?").join(", ");
}

/** Last inserted rowid. */
export function insertedId(result: { lastInsertRowid: number }): number {
  return result.lastInsertRowid;
}
