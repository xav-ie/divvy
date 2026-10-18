import { describe, expect, it } from "vitest";
import {
  createExpense,
  getExpense,
  updateExpense,
} from "../../src/services/expenses.ts";
import { createGroup } from "../../src/services/groups.ts";
import { ServiceError } from "../../src/services/errors.ts";
import { setup, simpleExpense } from "../helpers.ts";

describe("tax, tip and discount modes", () => {
  it("keeps a percent and recomputes it when the items change", () =>
    setup(async ({ as }) => {
      const ana = as("ana@example.com");
      const g = createGroup(ana, { name: "House" });
      const a = ana.user.memberId;
      const base = simpleExpense("Dinner", 10000, a, [a]);
      const e = createExpense(ana, g.id, {
        ...base,
        taxMode: "percent",
        taxValue: 8.25,
        tipValue: 500,
        discountMode: "percent",
        discountValue: 10,
        payers: { [a]: 10325 },
      });
      expect(e).toMatchObject({
        taxMode: "percent",
        taxValue: 8.25,
        taxCents: 825,
        tipMode: "amount",
        tipValue: 500,
        tipCents: 500,
        discountMode: "percent",
        discountCents: 1000,
        totalCents: 10325,
      });

      const again = simpleExpense("Dinner", 20000, a, [a]);
      const u = updateExpense(ana, e.id, {
        ...again,
        taxMode: "percent",
        taxValue: getExpense(ana, e.id).taxValue,
        payers: { [a]: 21650 },
      });
      expect(u).toMatchObject({ taxCents: 1650, totalCents: 21650 });

      // Plain cents still work as an amount.
      const plain = createExpense(ana, g.id, {
        ...base,
        taxCents: 100,
        payers: { [a]: 10100 },
      });
      expect(plain).toMatchObject({
        taxMode: "amount",
        taxValue: 100,
        taxCents: 100,
      });

      let err: unknown;
      try {
        createExpense(ana, g.id, { ...base, taxMode: "percent" });
      } catch (x) {
        err = x;
      }
      expect(err).toEqual(new ServiceError(400, "Tax: give the percent"));
    }));
});
