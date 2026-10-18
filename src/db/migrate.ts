import type { Db } from "./connection.ts";
import { all, run } from "./rows.ts";
import { transaction } from "./transaction.ts";

/** `migrations/NNN_name.sql`, bundled: file name -> SQL. */
export const MIGRATIONS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../../migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([path, sql]) => [path.split("/").pop()!, sql]),
);

/**
 * Apply every migration not yet recorded, in order. Returns the names applied.
 *
 * Foreign keys stay on: a Durable Object can't turn them back on once its
 * implicit transaction has begun. Checks are deferred to commit, but cascades
 * still fire, so a migration that rebuilds a referenced table must copy and
 * restore the rows that reference it.
 */
export function migrate(db: Db, files = MIGRATIONS): string[] {
  return transaction(db, () => {
    db.sql.exec("PRAGMA defer_foreign_keys = ON");
    db.sql.exec(
      "CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied TEXT NOT NULL)",
    );
    const done = new Set(
      all<{ name: string }>(db, "SELECT name FROM migrations").map(
        (r) => r.name,
      ),
    );
    const pending = Object.keys(files)
      .filter((f) => /^\d{3}_.+\.sql$/.test(f) && !done.has(f))
      .sort();
    for (const name of pending) {
      db.sql.exec(files[name]!);
      run(
        db,
        "INSERT INTO migrations (name, applied) VALUES (?, ?)",
        name,
        new Date().toISOString(),
      );
    }
    const broken = all(db, "PRAGMA foreign_key_check");
    if (broken.length)
      throw new Error(
        `divvy: migrations left broken references: ${JSON.stringify(broken.slice(0, 5))}`,
      );
    return pending;
  });
}
