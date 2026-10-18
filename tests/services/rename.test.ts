import { describe, expect, it } from "vitest";
import { listActivity } from "../../src/services/activity.ts";
import { ServiceError } from "../../src/services/errors.ts";
import { createGroup, getGroup } from "../../src/services/groups.ts";
import {
  addMember,
  invitePlaceholder,
  updatePlaceholder,
} from "../../src/services/members.ts";
import { setup } from "../helpers.ts";

const status = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof ServiceError) return `${e.status} ${e.message}`;
    throw e;
  }
};

describe("renaming placeholders", () => {
  it("lets only the group's creator rename or invite a placeholder", () =>
    setup(async ({ as }) => {
      const ana = as("ana@example.com");
      const ben = as("ben@example.com");
      const eve = as("eve@example.com");
      const g = createGroup(ana, { name: "House" });
      addMember(ana, g.id, { email: "ben@example.com" });
      const cy = addMember(ana, g.id, { name: "Cy" });

      const ONLY =
        "403 Only the group's creator can change people who haven't joined yet";
      expect(
        status(() => updatePlaceholder(ben, g.id, cy.id, { name: "Cyrus" })),
      ).toBe(ONLY);
      expect(
        status(() =>
          updatePlaceholder(ben, g.id, cy.id, { email: "ben2@example.com" }),
        ),
      ).toBe(ONLY);
      expect(
        status(() =>
          invitePlaceholder(ben, g.id, cy.id, { email: "ben2@example.com" }),
        ),
      ).toBe(ONLY);
      expect(updatePlaceholder(ana, g.id, cy.id, { name: "Cyrus" }).name).toBe(
        "Cyrus",
      );
      expect(listActivity(ben)[0]!.sentence).toBe("Ana renamed Cy to Cyrus");
      expect(
        status(() => updatePlaceholder(eve, g.id, cy.id, { name: "X" })),
      ).toBe("404 Group not found");
      expect(
        status(() => updatePlaceholder(ana, g.id, cy.id, { name: "" })),
      ).toBe("400 name: Name can't be empty");
      // Rename plus invite in one go keeps invite behavior.
      const both = updatePlaceholder(ana, g.id, cy.id, {
        name: "Cy R",
        email: "cy@example.com",
      });
      expect(both).toMatchObject({
        name: "Cy R",
        inviteEmail: "cy@example.com",
      });
    }));

  it("leaves people with accounts to rename themselves", () =>
    setup(async ({ as }) => {
      const ana = as("ana@example.com");
      const ben = as("ben@example.com");
      const g = createGroup(ana, { name: "House" });
      addMember(ana, g.id, { email: "ben@example.com" });
      const b = ben.user.memberId;
      expect(status(() => updatePlaceholder(ana, g.id, b, { name: "B" }))).toBe(
        "403 Ben has an account and picks their own name",
      );
      expect(
        status(() =>
          updatePlaceholder(ana, g.id, ana.user.memberId, { name: "A" }),
        ),
      ).toBe("400 Change your own name in Profile");
      expect(getGroup(ana, g.id).members.map((m) => m.name)).toEqual([
        "Ana",
        "Ben",
      ]);
    }));
});

describe("adding placeholders by email", () => {
  it("lets non-creators add only fresh invite emails", () =>
    setup(async ({ as }) => {
      const ana = as("ana@example.com");
      const ben = as("ben@example.com");
      const g = createGroup(ana, { name: "House" });
      addMember(ana, g.id, { email: "ben@example.com" });
      const other = createGroup(ana, { name: "Other" });
      addMember(ana, other.id, { name: "Dee", email: "dee@example.com" });

      expect(
        status(() =>
          addMember(ben, g.id, { name: "Dee", email: "dee@example.com" }),
        ),
      ).toBe(
        "403 Someone was already invited with that email; ask the group's creator to add them",
      );
      expect(
        addMember(ben, g.id, { name: "Fay", email: "fay@example.com" })
          .inviteEmail,
      ).toBe("fay@example.com");
      expect(addMember(ben, g.id, { name: "Gus" }).placeholder).toBe(true);
      // Adding someone who already has an account just adds them.
      as("hal@example.com");
      expect(
        addMember(ben, g.id, { email: "hal@example.com" }).placeholder,
      ).toBe(false);
      // The creator may still add a second placeholder for an invited email.
      expect(
        addMember(ana, g.id, { name: "Dee", email: "dee@example.com" }).name,
      ).toBe("Dee");
    }));
});
