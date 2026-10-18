/** The Durable Object's storage: its SQLite database plus transactionSync. */
export type Db = DurableObjectStorage;

let current: Db | undefined;

/** Called once by the Durable Object (src/worker.ts) that owns the database. */
export function useDb(db: Db): void {
  current = db;
}

/** The app database. */
export function getDb(): Db {
  if (!current) throw new Error("divvy: the database isn't open yet");
  return current;
}
