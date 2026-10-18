import { describe, expect, it } from "vitest";
import { MIGRATIONS, migrate } from "../../src/db/migrate.ts";
import { all, run } from "../../src/db/rows.ts";
import { withDb } from "../helpers.ts";

describe("migrate", () => {
  it("leaves foreign keys on, so deletes cascade", () =>
    withDb((db) => {
      expect(migrate(db)).toEqual(Object.keys(MIGRATIONS).sort());
      expect(all(db, "PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
      run(db, "INSERT INTO users (id, email, name) VALUES (1, 'a@x.com', 'A')");
      run(
        db,
        "INSERT INTO user_emails (user_id, email, is_primary) VALUES (1, 'a@x.com', 1)",
      );
      run(db, "DELETE FROM users WHERE id = 1");
      expect(all(db, "SELECT * FROM user_emails")).toEqual([]);
    }));

  it("is idempotent", () =>
    withDb((db) => {
      migrate(db);
      expect(migrate(db)).toEqual([]);
    }));
});
