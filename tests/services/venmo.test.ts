import { describe, expect, it } from "vitest";
import { venmoPayUrl } from "../../src/domain/venmo.ts";
import { ServiceError } from "../../src/services/errors.ts";
import { createExpense } from "../../src/services/expenses.ts";
import { createGroup } from "../../src/services/groups.ts";
import { addMember } from "../../src/services/members.ts";
import { updateProfile } from "../../src/services/users.ts";
import { singleGroupPay, venmoPlan } from "../../src/services/venmo.ts";
import { setup, simpleExpense, verifiedVenmo, type Setup } from "../helpers.ts";

describe("venmoPayUrl", () => {
  it("formats cents, drops the @ and encodes the note", () => {
    expect(venmoPayUrl("@Xavier-R", 12102, "divvy: Maple St & Co")).toBe(
      "https://venmo.com/Xavier-R?txn=pay&amount=121.02&note=divvy%3A%20Maple%20St%20%26%20Co",
    );
    expect(venmoPayUrl("ana_b1", 5, "x")).toContain("amount=0.05&");
    expect(venmoPayUrl("ana_b1", 100000, "x")).toContain("amount=1000.00&");
  });
});

describe("Venmo usernames", () => {
  it("validates, needs a check to save, and clears with null or empty", () =>
    setup(async ({ as }) => {
      const ana = as("ana@example.com");
      await expect(
        updateProfile(ana, { venmo: " @Ana-Ruiz_1 " }),
      ).rejects.toThrow(
        new ServiceError(400, "Check @Ana-Ruiz_1 on Venmo before saving it"),
      );
      verifiedVenmo(ana, "Ana-Ruiz_1");
      for (const bad of ["abc", "a".repeat(31), "ana ruiz", "ana.ruiz"])
        await expect(updateProfile(ana, { venmo: bad })).rejects.toThrow(
          new ServiceError(
            400,
            "venmo: Venmo usernames are 5 to 30 letters, digits, hyphens or underscores",
          ),
        );
      expect((await updateProfile(ana, { venmo: "" })).venmo).toBe(null);
      expect((await updateProfile(ana, { venmo: null })).venmo).toBe(null);
    }));
});

describe("venmoPlan", () => {
  function setupHouse({ as }: Setup) {
    const ana = as("ana@example.com");
    const ben = as("ben@example.com");
    const [a, b] = [ana.user.memberId, ben.user.memberId];
    const house = createGroup(ana, { name: "House" });
    addMember(ana, house.id, { email: "ben@example.com" });
    const cy = addMember(ana, house.id, { name: "Cy" });
    const trip = createGroup(ben, { name: "Trip" });
    addMember(ben, trip.id, { email: "ana@example.com" });
    return { ana, ben, a, b, house, trip, cy };
  }

  it("gives one link when everything you owe sits in one group", () =>
    setup(async (fx) => {
      const { ana, ben, a, b, house } = setupHouse(fx);
      createExpense(ben, house.id, simpleExpense("Rent", 30000, b, [a, b]));
      expect(venmoPlan(ana, b)).toBe(null); // no username yet
      verifiedVenmo(ben, "ben-pays");
      const pay = singleGroupPay(venmoPlan(ana, b))!;
      expect(pay).toMatchObject({
        name: "Ben",
        groupName: "House",
        cents: 15000,
      });
      expect(pay.url).toBe(
        "https://venmo.com/ben-pays?txn=pay&amount=150.00&note=divvy%3A%20House",
      );
      expect(pay.payment).toEqual({
        groupId: house.id,
        fromMember: a,
        toMember: b,
        cents: 15000,
      });
    }));

  it("never nets across groups or pays in the other direction", () =>
    setup(async (fx) => {
      const { ana, ben, a, b, house, trip, cy } = setupHouse(fx);
      verifiedVenmo(ben, "ben-pays");
      createExpense(ben, house.id, simpleExpense("Rent", 30000, b, [a, b]));
      createExpense(ana, trip.id, simpleExpense("Gas", 4000, a, [a, b]));
      const plan = venmoPlan(ana, b)!;
      // Ana owes Ben 150 in House; Ben owes Ana 20 in Trip: two groups, no single link.
      expect(plan.groups).toBe(2);
      expect(singleGroupPay(plan)).toBe(null);
      expect(
        plan.pays.map((p) => [p.groupName, p.cents, p.payment.fromMember]),
      ).toEqual([["House", 15000, a]]);
      expect(venmoPlan(ana, b, trip.id)!.pays).toEqual([]);

      // Ben is owed in Trip only from his side; he never gets a link to Ana's username.
      verifiedVenmo(ana, "ana-gets");
      expect(venmoPlan(ben, a, house.id)!.pays).toEqual([]);
      // Placeholders can't have a username.
      createExpense(
        ana,
        house.id,
        simpleExpense("Pizza", 2000, cy.id, [a, cy.id]),
      );
      expect(venmoPlan(ana, cy.id)).toBe(null);
    }));
});
