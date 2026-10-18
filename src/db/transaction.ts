import type { Db } from "./connection.ts";

/** Run `fn` atomically; nested calls nest. Rolls back if `fn` throws. */
export function transaction<T>(db: Db, fn: () => T): T {
  return db.transactionSync(fn);
}
