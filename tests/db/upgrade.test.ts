import { describe, expect, it } from "vitest";
import type { Db } from "../../src/db/connection.ts";
import { MIGRATIONS, migrate } from "../../src/db/migrate.ts";
import { all, one } from "../../src/db/rows.ts";
import { withDb } from "../helpers.ts";

const ALL = Object.keys(MIGRATIONS)
  .filter((f) => /^\d{3}_.+\.sql$/.test(f))
  .sort();
/**
 * The schema divvy's data had when it moved to Workers; the database has
 * only ever been upgraded from here since.
 */
const BASELINE = "015_fixed_recurring.sql";

if (ALL.length === 0) throw new Error("no migrations found next to the tests?");

/** The stable core world: insertable at every schema version since 001. */
function seedWorld(db: Db): void {
  db.sql.exec(`
    INSERT INTO users (id, email, name) VALUES
      (1, 'ana@example.com', 'Ana'),
      (2, 'ben@example.com', 'Ben');
    INSERT INTO members (id, user_id, name, placeholder) VALUES
      (10, 1, 'Ana', 0),
      (11, 2, 'Ben', 0),
      (12, NULL, 'Cy', 1);
    UPDATE members SET invite_email = 'cy@example.com' WHERE id = 12;
    INSERT INTO groups (id, name, created_by) VALUES (100, 'Flat', 1);
    INSERT INTO group_members (group_id, member_id) VALUES
      (100, 10), (100, 11), (100, 12);
    INSERT INTO expenses (id, group_id, title, date, total_cents, created_by) VALUES
      (1000, 100, 'Groceries', '2026-10-01', 9001, 1);
    INSERT INTO expense_items (expense_id, position, name, quantity, unit_cents, split_type, split) VALUES
      (1000, 1, 'Groceries', 1, 9001, 'equal', '{"10":1,"11":1,"12":1}');
    INSERT INTO expense_payers (expense_id, member_id, cents) VALUES (1000, 10, 9001);
    INSERT INTO expense_shares (expense_id, member_id, cents) VALUES
      (1000, 10, 3001), (1000, 11, 3000), (1000, 12, 3000);
    INSERT INTO payments (id, group_id, from_member, to_member, cents, date, created_by) VALUES
      (2000, 100, 11, 10, 500, '2026-10-03', 2);
    INSERT INTO recurring (group_id, title, day_of_month, amount_cents, split, payer_member, created_by) VALUES
      (100, 'Internet', 28, 8999, '{"10":1,"11":1}', 10, 1);
  `);
}

function snapshot(db: Db) {
  return {
    users: all(db, "SELECT id, email, name FROM users ORDER BY id"),
    members: all(
      db,
      "SELECT id, user_id, name, placeholder FROM members ORDER BY id",
    ),
    groups: all(db, "SELECT id, name FROM groups ORDER BY id"),
    membersOfGroup: all(
      db,
      "SELECT member_id FROM group_members WHERE group_id = 100 ORDER BY member_id",
    ),
    expense: all(db, "SELECT id, title, total_cents FROM expenses ORDER BY id"),
    shares: all(
      db,
      "SELECT member_id, cents FROM expense_shares WHERE expense_id = 1000 ORDER BY member_id",
    ),
    payers: all(
      db,
      "SELECT member_id, cents FROM expense_payers WHERE expense_id = 1000 ORDER BY member_id",
    ),
    payments: all(
      db,
      "SELECT id, from_member, to_member, cents FROM payments ORDER BY id",
    ),
    recurring: all(
      db,
      "SELECT title, day_of_month, amount_cents FROM recurring ORDER BY id",
    ),
  };
}

function checkInvariants(db: Db) {
  const fk = all(db, "PRAGMA foreign_key_check");
  expect(fk).toEqual([]);
  const applied = all(db, "SELECT name FROM migrations ORDER BY name").map(
    (r) => (r as { name: string }).name,
  );
  expect(applied).toEqual(ALL);
  const splitSum = one(
    db,
    "SELECT COALESCE(SUM(cents), 0) AS s FROM expense_shares WHERE expense_id = 1000",
  ) as { s: number };
  const total = one(db, "SELECT total_cents FROM expenses WHERE id = 1000") as {
    total_cents: number;
  };
  expect(splitSum.s).toBe(total.total_cents);
}

describe("migration upgrade paths", () => {
  it("knows the full list (guard the guard)", () => {
    expect(ALL[0]).toBe("001_init.sql");
    expect(ALL.length).toBeGreaterThanOrEqual(15);
  });

  it("installs fresh from empty", () =>
    withDb((db) => {
      expect(migrate(db)).toEqual(ALL);
      expect(all(db, "PRAGMA foreign_key_check")).toEqual([]);
      const applied = all(db, "SELECT name FROM migrations ORDER BY name").map(
        (r) => (r as { name: string }).name,
      );
      expect(applied).toEqual(ALL);
    }));

  for (let k = ALL.indexOf(BASELINE) + 1; k <= ALL.length; k++) {
    const upto = ALL[k - 1]!;
    it(`upgrades cleanly from ${upto} (${k} applied) with data intact`, () =>
      withDb((db) => {
        const first = Object.fromEntries(
          ALL.slice(0, k).map((f) => [f, MIGRATIONS[f]!]),
        );
        expect(migrate(db, first)).toEqual(ALL.slice(0, k));

        seedWorld(db);
        const before = snapshot(db);

        expect(migrate(db)).toEqual(ALL.slice(k));
        checkInvariants(db);
        expect(snapshot(db)).toEqual(before);
        expect(migrate(db, first)).toEqual([]); // idempotent at head
      }));
  }
});

describe("migration files", () => {
  it("are zero-padded and gapless", () => {
    const nums = ALL.map((f) => Number(f.slice(0, 3)));
    for (let i = 0; i < nums.length; i++) expect(nums[i]).toBe(i + 1);
  });
});
