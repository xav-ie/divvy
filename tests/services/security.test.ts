import { describe, expect, it } from "vitest";
import { insertMember } from "../../src/db/members.ts";
import { addGroupMember } from "../../src/db/groups.ts";
import { ServiceError } from "../../src/services/errors.ts";
import {
  createGroup,
  getGroup,
  listGroups,
} from "../../src/services/groups.ts";
import { addMember, invitePlaceholder } from "../../src/services/members.ts";
import { setup } from "../helpers.ts";

const status = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof ServiceError) return e.status;
    throw e;
  }
};

describe("placeholders can't leak groups", () => {
  it("stops Mallory joining a group through someone else's placeholder", () =>
    setup(async ({ as }) => {
      const ana = as("ana@example.com");
      const groupA = createGroup(ana, { name: "A" });
      const bobInA = addMember(ana, groupA.id, { email: "bob@x.com" });

      const mal = as("mal@x.com");
      const groupB = createGroup(mal, { name: "B" });
      const bobInB = addMember(mal, groupB.id, { email: "bob@x.com" });
      expect(bobInB.id).not.toBe(bobInA.id);
      invitePlaceholder(mal, groupB.id, bobInB.id, { email: "mal@x.com" });

      expect(listGroups(mal).map((g) => g.name)).toEqual(["B"]);
      expect(status(() => getGroup(mal, groupA.id))).toBe(404);
      expect(getGroup(ana, groupA.id).members.map((m) => m.id)).toContain(
        bobInA.id,
      );
    }));

  it("refuses to invite a placeholder that is shared with another group", () =>
    setup(async ({ db, as }) => {
      const ana = as("ana@example.com");
      const a = createGroup(ana, { name: "A" });
      const mal = as("mal@x.com");
      const b = createGroup(mal, { name: "B" });
      const shared = insertMember(db, { name: "Bob", placeholder: true });
      addGroupMember(db, a.id, shared);
      addGroupMember(db, b.id, shared);
      expect(
        status(() =>
          invitePlaceholder(mal, b.id, shared, { email: "mal@x.com" }),
        ),
      ).toBe(409);
      expect(listGroups(mal).map((g) => g.name)).toEqual(["B"]);
    }));
});
