import { describe, expect, it } from "vitest";
import { recurringStatus } from "../../src/domain/recurring.ts";
import { listActivity } from "../../src/services/activity.ts";
import { ServiceError } from "../../src/services/errors.ts";
import { getExpense, listExpenses } from "../../src/services/expenses.ts";
import { createGroup } from "../../src/services/groups.ts";
import { addMember } from "../../src/services/members.ts";
import {
  billDue,
  billRecurring,
  createRecurring,
  deleteRecurring,
  listRecurring,
  updateRecurring,
} from "../../src/services/recurring.ts";
import { setup, type Setup } from "../helpers.ts";
import { run } from "../../src/db/rows.ts";

function house({ db, as }: Setup) {
  const ana = as("ana@example.com");
  const ben = as("ben@example.com");
  const group = createGroup(ana, { name: "House" });
  addMember(ana, group.id, { email: "ben@example.com" });
  const cy = addMember(ana, group.id, { name: "Cy" });
  const a = ana.user.memberId;
  const b = ben.user.memberId;
  return { db, as, ana, ben, cy, group, a, b };
}

function message(fn: () => unknown): string {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof ServiceError) return `${e.status} ${e.message}`;
    throw e;
  }
}

describe("recurringStatus", () => {
  it("is upcoming before the day, due from it, billed once billed", () => {
    expect(
      recurringStatus({ dayOfMonth: 5, lastMonth: null }, "2026-03-04"),
    ).toBe("upcoming");
    expect(
      recurringStatus({ dayOfMonth: 5, lastMonth: null }, "2026-03-05"),
    ).toBe("due");
    expect(
      recurringStatus({ dayOfMonth: 5, lastMonth: "2026-02" }, "2026-03-28"),
    ).toBe("due");
    expect(
      recurringStatus({ dayOfMonth: 5, lastMonth: "2026-03" }, "2026-03-28"),
    ).toBe("billed");
  });
});

describe("recurring bills", () => {
  it("bills fixed templates once per month on their day", () =>
    setup(async (fx) => {
      const { db, ana, ben, group, a, b } = house(fx);
      const rent = createRecurring(
        ana,
        group.id,
        {
          title: "Rent",
          dayOfMonth: 1,
          amountCents: 200000,
          split: { [a]: 1, [b]: 1 },
          payerMemberId: a,
        },
        "2026-02-01",
      );
      const internet = createRecurring(
        ben,
        group.id,
        {
          title: "Internet",
          dayOfMonth: 15,
          amountCents: 6000,
          split: { [a]: 1, [b]: 2 },
          payerMemberId: b,
        },
        "2026-02-01",
      );

      expect(billDue(db, "2026-03-10").billed.map((r) => r.title)).toEqual([
        "Rent",
      ]);
      expect(billDue(db, "2026-03-10").billed).toEqual([]);
      expect(billDue(db, "2026-03-20").billed.map((r) => r.title)).toEqual([
        "Internet",
      ]);

      const expenses = listExpenses(ana, group.id);
      expect(expenses.map((e) => [e.title, e.date])).toEqual([
        ["Internet", "2026-03-15"],
        ["Rent", "2026-03-01"],
      ]);
      const net = getExpense(ana, expenses[0]!.id);
      expect(net.recurringId).toBe(internet.id);
      expect(net.createdBy).toBe(ben.user.id);
      expect(net.payers).toEqual({ [b]: 6000 });
      expect(net.shares).toEqual({ [a]: 2000, [b]: 4000 });

      const statuses = listRecurring(ana, group.id, "2026-03-20").map((t) => [
        t.title,
        t.status,
      ]);
      expect(statuses).toEqual([
        ["Rent", "billed"],
        ["Internet", "billed"],
      ]);
      expect(
        listRecurring(ana, group.id, "2026-04-01").find(
          (t) => t.id === rent.id,
        )!.status,
      ).toBe("due");
      expect(listActivity(ana)[0]!.sentence).toBe(
        'Ben billed "Internet" for March 2026 ($60.00)',
      );
    }));

  it("needs a fixed amount, skips paused templates and bills on request for the template's amount", () =>
    setup(async (fx) => {
      const { db, ana, ben, group, a, b } = house(fx);
      expect(
        message(() =>
          createRecurring(
            ana,
            group.id,
            {
              title: "Power",
              dayOfMonth: 3,
              split: { [a]: 1 },
              payerMemberId: a,
            } as never,
            "2026-02-01",
          ),
        ),
      ).toBe("400 amountCents: Enter the monthly amount");
      const power = createRecurring(
        ana,
        group.id,
        {
          title: "Power",
          dayOfMonth: 3,
          amountCents: 8001,
          split: { [a]: 1, [b]: 1 },
          payerMemberId: a,
        },
        "2026-02-01",
      );
      const rent = createRecurring(
        ana,
        group.id,
        {
          title: "Rent",
          dayOfMonth: 1,
          amountCents: 1000,
          split: { [a]: 1 },
          payerMemberId: a,
        },
        "2026-02-01",
      );
      expect(updateRecurring(ana, rent.id, { paused: true }).paused).toBe(true);
      updateRecurring(ana, power.id, { paused: true });
      expect(billDue(db, "2026-03-28").billed).toEqual([]);

      // Paused bills don't add themselves, but billing by hand still works.
      const { expenseId } = billRecurring(ben, power.id, {}, "2026-03-05");
      expect(getExpense(ana, expenseId).shares).toEqual({
        [a]: 4001,
        [b]: 4000,
      });
      expect(
        message(() => billRecurring(ben, power.id, {}, "2026-03-05")),
      ).toBe('400 "Power" is already billed for March 2026');
      expect(
        message(() =>
          billRecurring(ben, power.id, { month: "2026-04" }, "2026-03-05"),
        ),
      ).toBe("400 April 2026 hasn't started yet");
    }));

  it("checks members and permissions", () =>
    setup(async (fx) => {
      const { as, ana, ben, cy, group, a, b } = house(fx);
      const t = createRecurring(
        ben,
        group.id,
        {
          title: "Water",
          dayOfMonth: 2,
          amountCents: 500,
          split: { [a]: 1, [cy.id]: 1 },
          payerMemberId: b,
        },
        "2026-02-01",
      );
      expect(
        message(() =>
          createRecurring(
            ana,
            group.id,
            {
              title: "x",
              dayOfMonth: 29,
              amountCents: 100,
              split: { [a]: 1 },
              payerMemberId: a,
            },
            "2026-02-01",
          ),
        ),
      ).toBe("400 dayOfMonth: Pick a day from 1 to 28");
      expect(
        message(() =>
          createRecurring(
            ana,
            group.id,
            {
              title: "x",
              dayOfMonth: 1,
              amountCents: 100,
              split: { 9999: 1 },
              payerMemberId: a,
            },
            "2026-02-01",
          ),
        ),
      ).toBe("400 Everyone on a recurring bill must be in the group");
      // Group creator and template creator may edit; nobody outside sees it.
      expect(updateRecurring(ana, t.id, { title: "Water bill" }).title).toBe(
        "Water bill",
      );
      expect(updateRecurring(ben, t.id, { dayOfMonth: 3 }).amountCents).toBe(
        500,
      );
      expect(
        message(() => listRecurring(as("eve@example.com"), group.id)),
      ).toBe("404 Group not found");
      deleteRecurring(ben, t.id);
      expect(listRecurring(ana, group.id)).toEqual([]);
    }));

  it("forbids other members from editing", () =>
    setup(async (fx) => {
      const { ana, ben, group, a } = house(fx);
      const t = createRecurring(
        ana,
        group.id,
        {
          title: "Rent",
          dayOfMonth: 1,
          amountCents: 100,
          split: { [a]: 1 },
          payerMemberId: a,
        },
        "2026-02-01",
      );
      expect(message(() => deleteRecurring(ben, t.id))).toMatch(/^403 /);
      expect(message(() => billRecurring(ben, t.id, {}, "2026-02-02"))).toBe(
        "ok",
      );
    }));
});

describe("removing members on recurring bills", () => {
  it("refuses while a template references them, naming it", () =>
    setup(async (fx) => {
      const { removeMember } = await import("../../src/services/members.ts");
      const { ana, cy, group, a } = house(fx);
      const t = createRecurring(
        ana,
        group.id,
        {
          title: "Water",
          dayOfMonth: 1,
          amountCents: 100,
          split: { [a]: 1, [cy.id]: 1 },
          payerMemberId: a,
        },
        "2026-02-01",
      );
      expect(message(() => removeMember(ana, group.id, cy.id))).toBe(
        '409 Cy is on recurring bill "Water"; edit or delete it first',
      );
      updateRecurring(ana, t.id, { split: { [a]: 1 } });
      expect(message(() => removeMember(ana, group.id, cy.id))).toBe("ok");
    }));
});

describe("recurring billing rules", () => {
  it("starts next month when the day already passed, unless asked to bill now", () =>
    setup(async (fx) => {
      const { db, ana, group, a } = house(fx);
      const base = {
        dayOfMonth: 5,
        amountCents: 1000,
        split: { [a]: 1 },
        payerMemberId: a,
      };
      const late = createRecurring(
        ana,
        group.id,
        { ...base, title: "Late" },
        "2026-03-20",
      );
      expect(late).toMatchObject({
        status: "upcoming",
        canBillNow: false,
        startsMonth: "2026-04",
        lastMonth: null,
      });
      expect(message(() => billRecurring(ana, late.id, {}, "2026-03-21"))).toBe(
        '400 "Late" starts in April 2026',
      );
      const now = createRecurring(
        ana,
        group.id,
        { ...base, title: "Now", billThisMonth: true },
        "2026-03-20",
      );
      // Billed right away, dated its day this month.
      expect(now).toMatchObject({ status: "billed", startsMonth: "2026-03" });
      expect(getExpense(ana, now.expenseId!).date).toBe("2026-03-05");
      expect(billDue(db, "2026-03-20").billed).toEqual([]);
      expect(billDue(db, "2026-04-05").billed.map((b) => b.title)).toEqual([
        "Late",
        "Now",
      ]);
    }));

  it("bills a template early, dated today", () =>
    setup(async (fx) => {
      const { ana, group, a } = house(fx);
      const power = createRecurring(
        ana,
        group.id,
        {
          title: "Power",
          dayOfMonth: 20,
          amountCents: 4200,
          split: { [a]: 1 },
          payerMemberId: a,
        },
        "2026-03-01",
      );
      const [view] = listRecurring(ana, group.id, "2026-03-10");
      expect(view).toMatchObject({ status: "upcoming", canBillNow: true });
      const { expenseId } = billRecurring(ana, power.id, {}, "2026-03-10");
      expect(getExpense(ana, expenseId).date).toBe("2026-03-10");
      expect(listRecurring(ana, group.id, "2026-03-11")[0]).toMatchObject({
        status: "billed",
        canBillNow: false,
      });
    }));

  it("claims a month once", () =>
    setup(async (fx) => {
      const { claimMonth } = await import("../../src/db/recurring.ts");
      const { db, ana, group, a } = house(fx);
      const t = createRecurring(
        ana,
        group.id,
        {
          title: "Rent",
          dayOfMonth: 1,
          amountCents: 1,
          split: { [a]: 1 },
          payerMemberId: a,
        },
        "2026-02-01",
      );
      expect(claimMonth(db, t.id, "2026-03")).toBe(true);
      expect(claimMonth(db, t.id, "2026-03")).toBe(false);
      expect(claimMonth(db, t.id, "2026-02")).toBe(false);
      expect(message(() => billRecurring(ana, t.id, {}, "2026-03-02"))).toBe(
        '400 "Rent" is already billed for March 2026',
      );
    }));

  it("flags a look-alike expense that month, and recur skips it", () =>
    setup(async (fx) => {
      const { createExpense } = await import("../../src/services/expenses.ts");
      const { simpleExpense } = await import("../helpers.ts");
      const { db, ana, group, a } = house(fx);
      const t = createRecurring(
        ana,
        group.id,
        {
          title: "Rent",
          dayOfMonth: 1,
          amountCents: 1000,
          split: { [a]: 1 },
          payerMemberId: a,
        },
        "2026-02-01",
      );
      const manual = createExpense(
        ana,
        group.id,
        simpleExpense("rent march", 1000, a, [a], "2026-03-01"),
      );
      let err: unknown;
      try {
        billRecurring(ana, t.id, {}, "2026-03-02");
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({
        status: 409,
        data: { existingExpenseId: manual.id },
      });
      const out = billDue(db, "2026-03-02");
      expect(out.billed).toEqual([]);
      expect(out.skipped).toEqual([
        { recurringId: t.id, title: "Rent", expenseId: manual.id },
      ]);
      expect(listRecurring(ana, group.id, "2026-03-02")[0]!.status).toBe(
        "billed",
      );

      // Next month a look-alike can still be billed on purpose.
      createExpense(
        ana,
        group.id,
        simpleExpense("Rent", 1000, a, [a], "2026-04-01"),
      );
      expect(
        message(() =>
          billRecurring(ana, t.id, { confirmDuplicate: true }, "2026-04-02"),
        ),
      ).toBe("ok");
    }));
});

describe("deleting a billed recurring expense", () => {
  it("offers the month for manual billing only", () =>
    setup(async (fx) => {
      const { deleteExpense, restoreExpense } =
        await import("../../src/services/expenses.ts");
      const { listExpenses } = await import("../../src/services/expenses.ts");
      const { db, ana, group, a } = house(fx);
      const t = createRecurring(
        ana,
        group.id,
        {
          title: "Rent",
          dayOfMonth: 1,
          amountCents: 1000,
          split: { [a]: 1 },
          payerMemberId: a,
        },
        "2026-09-01",
      );
      const { expenseId } = billDue(db, "2026-10-02").billed[0]!;
      deleteExpense(ana, expenseId);
      expect(listRecurring(ana, group.id, "2026-10-02")[0]).toMatchObject({
        status: "due",
        canBillNow: true,
        lastMonth: "2026-09",
        manualMonth: "2026-10",
      });

      expect(billDue(db, "2026-10-03")).toEqual({
        billed: [],
        skipped: [],
        failed: [],
      });
      expect(listExpenses(ana, group.id)).toEqual([]);

      const manual = billRecurring(ana, t.id, {}, "2026-10-03");
      expect(message(() => billRecurring(ana, t.id, {}, "2026-10-03"))).toBe(
        '400 "Rent" is already billed for October 2026',
      );
      expect(listRecurring(ana, group.id, "2026-10-03")[0]).toMatchObject({
        status: "billed",
        manualMonth: null,
      });
      let err: unknown;
      try {
        restoreExpense(ana, expenseId);
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({
        status: 409,
        data: { existingExpenseId: manual.expenseId },
      });

      // November bills automatically again.
      expect(
        billDue(db, "2026-11-01").billed.map((b) => b.recurringId),
      ).toEqual([t.id]);
    }));

  it("shows a deleted month as due before its day", () =>
    setup(async (fx) => {
      const { deleteExpense } = await import("../../src/services/expenses.ts");
      const { ana, group, a } = house(fx);
      const power = createRecurring(
        ana,
        group.id,
        {
          title: "Power",
          dayOfMonth: 20,
          amountCents: 500,
          split: { [a]: 1 },
          payerMemberId: a,
        },
        "2026-10-01",
      );
      const { expenseId } = billRecurring(ana, power.id, {}, "2026-10-05");
      deleteExpense(ana, expenseId);
      expect(listRecurring(ana, group.id, "2026-10-06")[0]).toMatchObject({
        status: "due",
        canBillNow: true,
      });
    }));
});

describe("migration 015", () => {
  it("drops amount-less templates without bills and pauses the ones with bills", () =>
    setup(async (fx) => {
      const { MIGRATIONS } = await import("../../src/db/migrate.ts");
      const { db, ana, group, a } = house(fx);
      const make = (title: string) =>
        createRecurring(
          ana,
          group.id,
          {
            title,
            dayOfMonth: 1,
            amountCents: 500,
            split: { [a]: 1 },
            payerMemberId: a,
          },
          "2026-03-01",
        );
      const unused = make("Gas");
      const used = make("Power");
      const fixed = make("Rent");
      billRecurring(ana, used.id, {}, "2026-03-02");
      run(
        db,
        "UPDATE recurring SET amount_cents = NULL WHERE id IN (?, ?)",
        unused.id,
        used.id,
      );

      db.sql.exec(MIGRATIONS["015_fixed_recurring.sql"]!);
      const rows = listRecurring(ana, group.id, "2026-03-05").map((t) => [
        t.title,
        t.paused,
        t.amountCents,
      ]);
      expect(rows).toEqual([
        ["Power (varied; add as expenses)", true, 1],
        ["Rent", false, 500],
      ]);
      expect(fixed.id).toBeGreaterThan(0);
    }));
});
