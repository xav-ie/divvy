import { describe, expect, it } from "vitest";
import { ServiceError } from "../../src/services/errors.ts";
import {
  createExpense,
  deleteExpense,
  getExpense,
  updateExpense,
} from "../../src/services/expenses.ts";
import { createGroup } from "../../src/services/groups.ts";
import { addMember } from "../../src/services/members.ts";
import {
  deletePayment,
  listPayments,
  recordPayment,
} from "../../src/services/payments.ts";
import { setup, simpleExpense, type Setup } from "../helpers.ts";

const status = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof ServiceError) return e.status;
    throw e;
  }
};

function trio({ as }: Setup) {
  const ana = as("ana@example.com");
  const ben = as("ben@example.com");
  const cy = as("cy@example.com");
  const group = createGroup(ana, { name: "House" });
  addMember(ana, group.id, { email: "ben@example.com" });
  addMember(ana, group.id, { email: "cy@example.com" });
  const [a, b, c] = [ana, ben, cy].map((x) => x.user.memberId) as [
    number,
    number,
    number,
  ];
  return { ana, ben, cy, group, a, b, c };
}

describe("who may edit", () => {
  it("lets the creator or a payer edit and delete an expense", () =>
    setup(async (fx) => {
      const { ana, ben, cy, group, a, b, c } = trio(fx);
      const e = createExpense(
        ana,
        group.id,
        simpleExpense("Pizza", 900, b, [a, b, c]),
      );
      expect(getExpense(ben, e.id).canEdit).toBe(true);
      expect(getExpense(cy, e.id).canEdit).toBe(false);
      expect(
        status(() =>
          updateExpense(cy, e.id, simpleExpense("x", 900, b, [a, b, c])),
        ),
      ).toBe(403);
      expect(
        status(() =>
          updateExpense(ben, e.id, simpleExpense("Pizza!", 900, b, [a, b, c])),
        ),
      ).toBe("ok");
      expect(status(() => deleteExpense(cy, e.id))).toBe(403);
      expect(status(() => deleteExpense(ben, e.id))).toBe("ok");
    }));

  it("lets the recorder or either person delete a payment", () =>
    setup(async (fx) => {
      const { ana, ben, cy, group, a, b } = trio(fx);
      const p = recordPayment(cy, group.id, {
        fromMember: b,
        toMember: a,
        cents: 500,
        date: "2026-01-01",
      });
      expect(listPayments(ana, group.id)[0]!.canEdit).toBe(true);
      expect(listPayments(ben, group.id)[0]!.canEdit).toBe(true);
      const q = recordPayment(ana, group.id, {
        fromMember: b,
        toMember: a,
        cents: 100,
        date: "2026-01-01",
      });
      expect(status(() => deletePayment(cy, q.id))).toBe(403);
      expect(status(() => deletePayment(ana, p.id))).toBe("ok");
      expect(status(() => deletePayment(ben, q.id))).toBe("ok");
    }));
});
