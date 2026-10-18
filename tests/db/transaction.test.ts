import { describe, expect, it } from "vitest";
import { all } from "../../src/db/rows.ts";
import { transaction } from "../../src/db/transaction.ts";
import { withDb } from "../helpers.ts";

describe("transaction", () => {
  it("nests, rolling back only the inner one that threw", () =>
    withDb((db) => {
      db.sql.exec("CREATE TABLE t (v INTEGER)");
      transaction(db, () => {
        db.sql.exec("INSERT INTO t VALUES (1)");
        expect(() =>
          transaction(db, () => {
            db.sql.exec("INSERT INTO t VALUES (2)");
            throw new Error("inner");
          }),
        ).toThrow("inner");
      });
      expect(all(db, "SELECT v FROM t")).toEqual([{ v: 1 }]);
    }));
});
