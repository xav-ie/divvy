import { describe, expect, it } from "vitest";
import {
  groupBalances,
  homeSummary,
  personDrillDown,
} from "../../src/services/balances.ts";
import { ServiceError } from "../../src/services/errors.ts";
import { createExpense } from "../../src/services/expenses.ts";
import { createGroup, updateGroup } from "../../src/services/groups.ts";
import { addMember } from "../../src/services/members.ts";
import { setup, simpleExpense } from "../helpers.ts";

describe("simplify as a group setting", () => {
  it("reroutes home balances and explains it in the drill-down", () =>
    setup(async ({ as }) => {
      const ana = as("ana@example.com");
      const ben = as("ben@example.com");
      const g = createGroup(ana, { name: "House" });
      addMember(ana, g.id, { email: "ben@example.com" });
      const cy = addMember(ana, g.id, { name: "Cy" });
      const [a, b, c] = [ana.user.memberId, ben.user.memberId, cy.id];
      createExpense(ana, g.id, simpleExpense("Pizza", 2000, a, [a, b]));
      createExpense(ben, g.id, simpleExpense("Taxi", 2000, b, [b, c]));

      expect(homeSummary(ana).people.map((p) => p.sentence)).toEqual([
        "Ben owes you $10.00",
      ]);
      expect(() => updateGroup(ben, g.id, { name: "Mine" })).toThrow(
        ServiceError,
      );
      expect(updateGroup(ben, g.id, { simplify: true }).simplify).toBe(true);
      expect(groupBalances(ana, g.id).simplify).toBe(true);

      expect(homeSummary(ana).people.map((p) => p.sentence)).toEqual([
        "Cy owes you $10.00",
      ]);
      const cyLines = personDrillDown(ana, c);
      expect(cyLines.sentence).toBe("Cy owes you $10.00");
      expect(cyLines.lines[0]).toMatchObject({
        kind: "simplify",
        runningCents: 1000,
        sentence:
          "Simplified in House: Cy pays you $10.00 directly instead of through other members",
      });
      const benLines = personDrillDown(ana, b);
      expect(benLines.cents).toBe(0);
      expect(benLines.lines[0]).toMatchObject({
        kind: "simplify",
        effectCents: -1000,
        runningSentence: "You and Ben are settled up",
      });
    }));
});

describe("drill-down history", () => {
  it("orders by date then recording time and reads settled up after a full settle-up", () =>
    setup(async ({ as }) => {
      const { recordPayment } = await import("../../src/services/payments.ts");
      const ana = as("ana@example.com");
      const ben = as("ben@example.com");
      const g = createGroup(ana, { name: "House" });
      addMember(ana, g.id, { email: "ben@example.com" });
      const [a, b] = [ana.user.memberId, ben.user.memberId];
      createExpense(
        ana,
        g.id,
        simpleExpense("Dinner", 4000, a, [a, b], "2026-03-01"),
      );
      recordPayment(ben, g.id, {
        fromMember: b,
        toMember: a,
        cents: 2000,
        date: "2026-03-05",
      });
      // Recorded after the payment but dated before it.
      createExpense(
        ana,
        g.id,
        simpleExpense("Lunch", 1000, a, [a, b], "2026-03-02"),
      );
      createExpense(
        ana,
        g.id,
        simpleExpense("Taxi", 600, a, [a, b], "2026-03-05"),
      );

      const dd = personDrillDown(ana, b);
      expect(dd.lines.map((l) => [l.title, l.runningSentence])).toEqual([
        ["Taxi", "Ben owes you $8.00"],
        ["", "Ben owes you $5.00"],
        ["Lunch", "Ben owes you $25.00"],
        ["Dinner", "Ben owes you $20.00"],
      ]);
      expect(dd.lines.every((l) => typeof l.createdAt === "string")).toBe(true);
      expect(dd.lines[2]!.createdAt! >= dd.lines[1]!.createdAt!).toBe(true);

      recordPayment(ben, g.id, {
        fromMember: b,
        toMember: a,
        cents: 800,
        date: "2026-03-06",
      });
      expect(personDrillDown(ana, b).lines[0]).toMatchObject({
        kind: "payment",
        runningCents: 0,
        runningSentence: "You and Ben are settled up",
      });
    }));
});

describe("payment prefill", () => {
  it("gives the biggest debt the viewer owes, following the simplify setting", () =>
    setup(async ({ as }) => {
      const ana = as("ana@example.com");
      const ben = as("ben@example.com");
      const g = createGroup(ana, { name: "House" });
      addMember(ana, g.id, { email: "ben@example.com" });
      const cy = addMember(ana, g.id, { name: "Cy" });
      const [a, b, c] = [ana.user.memberId, ben.user.memberId, cy.id];
      expect(groupBalances(ana, g.id).largestYouOwe).toBe(null);
      createExpense(ben, g.id, simpleExpense("Taxi", 2000, b, [a, b]));
      createExpense(ben, g.id, simpleExpense("Cab", 600, c, [a, c]));
      expect(groupBalances(ana, g.id).largestYouOwe).toMatchObject({
        from: a,
        to: b,
        cents: 1000,
        toName: "Ben",
        sentence: "You owe Ben $10.00",
      });
      expect(groupBalances(ben, g.id).largestYouOwe).toBe(null);
    }));
});
