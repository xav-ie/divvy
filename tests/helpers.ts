import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { useDb, type Db } from "../src/db/connection.ts";
import { migrate } from "../src/db/migrate.ts";
import { run } from "../src/db/rows.ts";
import type { Ctx } from "../src/services/context.ts";
import type { ExpenseInput } from "../src/services/schemas.ts";
import { signIn } from "../src/services/users.ts";

export interface Setup {
  db: Db;
  /** Act as this email (signed in on first use). */
  as: (email: string) => Ctx;
}

/**
 * Run `fn` inside a fresh Durable Object (its storage is only usable from
 * inside it) with an empty database.
 */
export function withDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  return runInDurableObject(
    env.DIVVY.getByName(crypto.randomUUID()),
    (_, state) => {
      useDb(state.storage);
      return fn(state.storage);
    },
  );
}

/** Like withDb, migrated, with a way to act as any email. */
export function setup<T>(fn: (t: Setup) => T | Promise<T>): Promise<T> {
  return withDb((db) => {
    migrate(db);
    return fn({ db, as: (email) => ({ db, user: signIn(db, email) }) });
  });
}

/** A one-item expense split equally among `among`, paid in full by `payer`. */
export function simpleExpense(
  title: string,
  cents: number,
  payer: number,
  among: number[],
  date = "2026-01-01",
): ExpenseInput {
  return {
    title,
    date,
    items: [
      {
        name: title,
        quantity: 1,
        unitCents: cents,
        splitType: "equal",
        split: Object.fromEntries(among.map((m) => [m, 1])),
      },
    ],
    payers: { [payer]: cents },
  };
}

/** Save a Venmo username as if Venmo had confirmed it (tests only; the app needs a found preview). */
export function verifiedVenmo(ctx: Ctx, username: string): void {
  run(
    ctx.db,
    "UPDATE users SET venmo = ?, venmo_status = 'found' WHERE id = ?",
    username,
    ctx.user.id,
  );
}
