import { describe, expect, it } from "vitest";
import { listActivity } from "../../src/services/activity.ts";
import {
  groupBalances,
  homeSummary,
  personDrillDown,
} from "../../src/services/balances.ts";
import { ServiceError } from "../../src/services/errors.ts";
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  previewExpense,
  updateExpense,
} from "../../src/services/expenses.ts";
import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  updateGroup,
} from "../../src/services/groups.ts";
import {
  addMember,
  invitePlaceholder,
  removeMember,
} from "../../src/services/members.ts";
import { deletePayment, recordPayment } from "../../src/services/payments.ts";
import { signIn, updateProfile } from "../../src/services/users.ts";
import { setup, simpleExpense, type Setup } from "../helpers.ts";

function status(fn: () => unknown): number | string {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof ServiceError) return e.status;
    throw e;
  }
}

function house({ db, as }: Setup) {
  const ana = as("ana@example.com");
  const ben = as("ben@example.com");
  const group = createGroup(ana, { name: "House", emoji: "🏠" });
  addMember(ana, group.id, { email: "ben@example.com" });
  const cy = addMember(ana, group.id, { name: "Cy" });
  return { db, as, ana, ben, cy, group };
}

describe("users", () => {
  it("creates a user on first sign-in with the email's local part as name", () =>
    setup(async ({ db }) => {
      const u = signIn(db, "Dee.Smith@Example.com");
      expect(u).toMatchObject({
        email: "dee.smith@example.com",
        name: "Dee.smith",
      });
      expect(signIn(db, "dee.smith@example.com").id).toBe(u.id);
    }));

  it("merges invited placeholders into the new user, keeping their shares", () =>
    setup(async (fx) => {
      const { db, ana, group } = house(fx);
      const dee = addMember(ana, group.id, {
        name: "Dee",
        email: "dee@example.com",
      });
      createExpense(
        ana,
        group.id,
        simpleExpense("Pizza", 2000, ana.user.memberId, [
          ana.user.memberId,
          dee.id,
        ]),
      );
      const other = createGroup(ana, { name: "Trip" });
      const dee2 = addMember(ana, other.id, { email: "dee@example.com" });
      expect(dee2.id).not.toBe(dee.id);

      const deeUser = signIn(db, "dee@example.com");
      expect(deeUser.memberId).toBe(dee.id);
      expect(deeUser.name).toBe("Dee");
      const deeCtx = { db, user: deeUser };
      expect(listGroups(deeCtx).map((g) => g.name)).toEqual(["House", "Trip"]);
      expect(homeSummary(deeCtx).sentence).toBe("Overall, you owe $10.00");
    }));

  it("merges a placeholder into an existing user when invited by their email", () =>
    setup(async (fx) => {
      const { db, ana, cy, group } = house(fx);
      const zed = signIn(db, "zed@example.com");
      createExpense(
        ana,
        group.id,
        simpleExpense("Pizza", 3000, ana.user.memberId, [
          ana.user.memberId,
          cy.id,
        ]),
      );
      const merged = invitePlaceholder(ana, group.id, cy.id, {
        email: "zed@example.com",
      });
      expect(merged.id).toBe(zed.memberId);
      expect(homeSummary({ db, user: zed }).people).toMatchObject([
        { name: "Ana", cents: -1500, sentence: "You owe Ana $15.00" },
      ]);
    }));

  it("renames the user and their member", () =>
    setup(async (fx) => {
      const { ana, group } = house(fx);
      await updateProfile(ana, { name: "Ana" });
      expect(getGroup(ana, group.id).members.find((m) => m.isYou)?.name).toBe(
        "Ana",
      );
    }));
});

describe("groups and permissions", () => {
  it("hides groups from non-members and limits admin to the creator", () =>
    setup(async (fx) => {
      const { as, ana, ben, group } = house(fx);
      const eve = as("eve@example.com");
      expect(status(() => getGroup(eve, group.id))).toBe(404);
      expect(
        status(() =>
          createExpense(
            eve,
            group.id,
            simpleExpense("X", 100, eve.user.memberId, [eve.user.memberId]),
          ),
        ),
      ).toBe(404);
      expect(status(() => updateGroup(ben, group.id, { name: "Mine" }))).toBe(
        403,
      );
      expect(status(() => deleteGroup(ben, group.id))).toBe(403);
      expect(updateGroup(ana, group.id, { name: "Home" }).name).toBe("Home");
      expect(getGroup(ben, group.id).isCreator).toBe(false);
    }));

  it("refuses to remove a member with a balance", () =>
    setup(async (fx) => {
      const { ana, ben, cy, group } = house(fx);
      createExpense(
        ana,
        group.id,
        simpleExpense("Milk", 400, ana.user.memberId, [
          ana.user.memberId,
          cy.id,
        ]),
      );
      expect(status(() => removeMember(ben, group.id, cy.id))).toBe(403);
      expect(status(() => removeMember(ana, group.id, cy.id))).toBe(409);
      recordPayment(ana, group.id, {
        fromMember: cy.id,
        toMember: ana.user.memberId,
        cents: 200,
        date: "2026-01-02",
      });
      removeMember(ana, group.id, cy.id);
      expect(getGroup(ana, group.id).members.map((m) => m.name)).toEqual([
        "Ana",
        "Ben",
      ]);
      expect(status(() => removeMember(ana, group.id, ana.user.memberId))).toBe(
        400,
      );
    }));

  it("deletes a group", () =>
    setup(async (fx) => {
      const { ana, group } = house(fx);
      deleteGroup(ana, group.id);
      expect(listGroups(ana)).toEqual([]);
    }));
});

describe("expenses", () => {
  it("stores computed shares and lets only the creator edit", () =>
    setup(async (fx) => {
      const { ana, ben, cy, group } = house(fx);
      const [a, b, c] = [ana.user.memberId, ben.user.memberId, cy.id];
      const e = createExpense(
        ana,
        group.id,
        simpleExpense("Pizza", 1000, a, [a, b, c]),
      );
      expect(e.shares).toEqual({ [a]: 334, [b]: 333, [c]: 333 });
      expect(e.canEdit).toBe(true);
      expect(getExpense(ben, e.id).canEdit).toBe(false);
      expect(
        status(() =>
          updateExpense(ben, e.id, simpleExpense("Mine", 100, b, [b])),
        ),
      ).toBe(403);
      expect(status(() => deleteExpense(ben, e.id))).toBe(403);
      const updated = updateExpense(
        ana,
        e.id,
        simpleExpense("Pizza", 1200, a, [a, b, c]),
      );
      expect(updated.totalCents).toBe(1200);
      expect(listExpenses(ben, group.id)).toHaveLength(1);
      deleteExpense(ana, e.id);
      expect(listExpenses(ben, group.id)).toHaveLength(0);
    }));

  it("explains invalid expenses", () =>
    setup(async (fx) => {
      const { as, ana, group } = house(fx);
      const a = ana.user.memberId;
      const outsider = as("eve@example.com").user.memberId;
      const bad = (input: Parameters<typeof previewExpense>[2]) => {
        try {
          previewExpense(ana, group.id, input);
          return "ok";
        } catch (e) {
          return (e as Error).message;
        }
      };
      expect(
        bad({ ...simpleExpense("X", 1000, a, [a]), payers: { [a]: 900 } }),
      ).toBe(
        "Paid amounts add up to $9.00 but the total is $10.00 ($1.00 left)",
      );
      expect(bad(simpleExpense("X", 1000, a, [outsider]))).toBe(
        "Everyone on an expense must be in the group",
      );
      expect(
        bad({ ...simpleExpense("X", 1000, a, [a]), date: "2026-02-30" }),
      ).toBe("That date doesn't exist");
      expect(bad({ ...simpleExpense("X", 1000, a, [a]), title: " " })).toBe(
        "title: Give the expense a title",
      );
    }));
});

describe("balances", () => {
  it("summarises, simplifies and drills down so running totals reach the headline", () =>
    setup(async (fx) => {
      const { ana, ben, cy, group } = house(fx);
      const [a, b, c] = [ana.user.memberId, ben.user.memberId, cy.id];
      createExpense(
        ana,
        group.id,
        simpleExpense("Groceries", 9000, a, [a, b, c], "2026-01-01"),
      );
      createExpense(
        ben,
        group.id,
        simpleExpense("Internet", 6000, b, [a, b, c], "2026-01-05"),
      );
      const pay = recordPayment(ben, group.id, {
        fromMember: b,
        toMember: a,
        cents: 500,
        date: "2026-01-06",
        note: "Venmo",
      });

      const home = homeSummary(ana);
      expect(home.sentence).toBe("Overall, you're owed $35.00");
      expect(home.people.map((p) => p.sentence)).toEqual([
        "Cy owes you $30.00",
        "Ben owes you $5.00",
      ]);

      const gb = groupBalances(ben, group.id);
      expect(gb.pairs.map((p) => p.sentence)).toEqual([
        "Cy owes you $20.00",
        "You owe Ana $5.00",
        "Cy owes Ana $30.00",
      ]);
      expect(gb.simplified.map((p) => p.sentence)).toEqual([
        "Cy owes you $15.00",
        "Cy owes Ana $35.00",
      ]);
      expect(gb.members.map((m) => m.sentence)).toEqual([
        "Ana is owed $35.00 in total",
        "You are owed $15.00 in total",
        "Cy owes $50.00 in total",
      ]);

      const dd = personDrillDown(ana, b);
      expect(dd.sentence).toBe("Ben owes you $5.00");
      expect(dd.lines.map((l) => [l.sentence, l.runningSentence])).toEqual([
        ["Venmo: Ben paid you $5.00", "Ben owes you $5.00"],
        [
          "Internet: Ben paid $60.00, your share $20.00, Ben's share $20.00, so you owe Ben $20.00",
          "Ben owes you $10.00",
        ],
        [
          "Groceries: you paid $90.00, your share $30.00, Ben's share $30.00, so Ben owes you $30.00",
          "Ben owes you $30.00",
        ],
      ]);
      expect(dd.lines[0]!.runningCents).toBe(dd.cents);
      expect(personDrillDown(ana, b, group.id).cents).toBe(500);
      expect(status(() => personDrillDown(ana, a))).toBe(404);

      deletePayment(ben, pay.id);
      expect(
        homeSummary(ana).people.find((p) => p.memberId === b)?.sentence,
      ).toBe("Ben owes you $10.00");
    }));

  it("records activity", () =>
    setup(async (fx) => {
      const { ana, ben, group } = house(fx);
      const a = ana.user.memberId;
      createExpense(
        ana,
        group.id,
        simpleExpense("Pizza", 1000, a, [a, ben.user.memberId]),
      );
      recordPayment(ben, group.id, {
        fromMember: ben.user.memberId,
        toMember: a,
        cents: 500,
        date: "2026-01-02",
      });
      expect(listActivity(ana).map((x) => x.sentence)).toEqual([
        "Ben paid you $5.00",
        'You added "Pizza" ($10.00)',
      ]);
      expect(
        listActivity(ben, { groupId: group.id }).map((x) => x.sentence),
      ).toEqual(["You paid Ana $5.00", 'Ana added "Pizza" ($10.00)']);
      const pay = recordPayment(ana, group.id, {
        fromMember: ben.user.memberId,
        toMember: a,
        cents: 100,
        date: "2026-01-03",
      });
      expect(listActivity(ana)[0]).toMatchObject({
        actorIsYou: true,
        entity: "payment",
        data: { fromMember: ben.user.memberId, toMember: a, cents: 100 },
        sentence: "You got $1.00 from Ben",
      });
      expect(listActivity(ben)[0]!.sentence).toBe("Ana got $1.00 from you");
      deletePayment(ben, pay.id);
      expect(listActivity(ana)[0]!.sentence).toBe(
        "Ben deleted a payment (Ben paid you $1.00)",
      );
    }));
});
