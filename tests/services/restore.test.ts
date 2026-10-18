import { describe, expect, it } from "vitest";
import { listActivity } from "../../src/services/activity.ts";
import { homeSummary } from "../../src/services/balances.ts";
import { ServiceError } from "../../src/services/errors.ts";
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  restoreExpense,
} from "../../src/services/expenses.ts";
import { createGroup } from "../../src/services/groups.ts";
import { addMember } from "../../src/services/members.ts";
import {
  deletePayment,
  listPayments,
  recordPayment,
  restorePayment,
} from "../../src/services/payments.ts";
import {
  billDue,
  billRecurring,
  createRecurring,
  listRecurring,
} from "../../src/services/recurring.ts";
import { setup, simpleExpense, type Setup } from "../helpers.ts";
import { run } from "../../src/db/rows.ts";

const status = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof ServiceError) return e.status;
    throw e;
  }
};

function house({ db, as }: Setup) {
  const ana = as("ana@example.com");
  const ben = as("ben@example.com");
  const cy = as("cy@example.com");
  const g = createGroup(ana, { name: "House" });
  addMember(ana, g.id, { email: "ben@example.com" });
  addMember(ana, g.id, { email: "cy@example.com" });
  const [a, b] = [ana.user.memberId, ben.user.memberId];
  return { db, ana, ben, cy, g, a, b };
}

describe("soft delete and restore", () => {
  it("hides a deleted expense everywhere and brings back the same row", () =>
    setup(async (fx) => {
      const { db, ana, cy, g, a, b } = house(fx);
      const e = createExpense(
        ana,
        g.id,
        simpleExpense("Pizza", 2000, a, [a, b]),
      );
      deleteExpense(ana, e.id);
      expect(listExpenses(ana, g.id)).toEqual([]);
      expect(status(() => getExpense(ana, e.id))).toBe(404);
      expect(homeSummary(ana).people).toEqual([]);
      expect(status(() => restoreExpense(cy, e.id))).toBe(403);

      const back = restoreExpense(ana, e.id);
      expect(back).toMatchObject({
        id: e.id,
        createdBy: e.createdBy,
        shares: e.shares,
        payers: e.payers,
        deletedAt: null,
      });
      expect(homeSummary(ana).people.map((p) => p.sentence)).toEqual([
        "Ben owes you $10.00",
      ]);
      expect(
        listActivity(ana)
          .map((x) => x.sentence)
          .slice(0, 2),
      ).toEqual([
        'You restored "Pizza" ($20.00)',
        'You deleted "Pizza" ($20.00)',
      ]);
      expect(status(() => restoreExpense(ana, e.id))).toBe(400);

      deleteExpense(ana, e.id);
      run(
        db,
        "UPDATE expenses SET deleted_at = '2020-01-01T00:00:00.000Z' WHERE id = ?",
        e.id,
      );
      expect(() => restoreExpense(ana, e.id)).toThrow(
        "This expense was deleted more than 7 days ago and can't be restored",
      );
    }));

  it("restores payments for whoever could delete them", () =>
    setup(async (fx) => {
      const { ana, ben, cy, g, a, b } = house(fx);
      const p = recordPayment(ben, g.id, {
        fromMember: b,
        toMember: a,
        cents: 500,
        date: "2026-01-01",
      });
      deletePayment(ana, p.id);
      expect(listPayments(ana, g.id)).toEqual([]);
      expect(status(() => restorePayment(cy, p.id))).toBe(403);
      expect(restorePayment(ben, p.id)).toMatchObject({ id: p.id, cents: 500 });
      expect(listActivity(ana)[0]!.sentence).toBe(
        "Ben restored a payment (Ben paid you $5.00)",
      );
    }));

  it("takes a recurring month back, or 409s if it was billed again", () =>
    setup(async (fx) => {
      const { db, ana, g, a } = house(fx);
      const t = createRecurring(
        ana,
        g.id,
        {
          title: "Rent",
          dayOfMonth: 1,
          amountCents: 1000,
          split: { [a]: 1 },
          payerMemberId: a,
        },
        "2026-02-01",
      );
      const { expenseId } = billDue(db, "2026-03-02").billed[0]!;
      deleteExpense(ana, expenseId);
      restoreExpense(ana, expenseId);
      expect(listRecurring(ana, g.id, "2026-03-02")[0]).toMatchObject({
        status: "billed",
        lastMonth: "2026-03",
      });

      deleteExpense(ana, expenseId);
      const again = billRecurring(ana, t.id, {}, "2026-03-02");
      let err: unknown;
      try {
        restoreExpense(ana, expenseId);
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({
        status: 409,
        data: { existingExpenseId: again.expenseId },
      });
    }));
});
