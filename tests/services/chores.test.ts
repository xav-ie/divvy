import { describe, expect, it } from "vitest";
import { listActivity } from "../../src/services/activity.ts";
import {
  addAway,
  createChore,
  deleteAway,
  deleteChore,
  listChores,
  myTurns,
  swapTurn,
  updateChore,
} from "../../src/services/chores.ts";
import { ServiceError } from "../../src/services/errors.ts";
import {
  createGroup,
  listGroups,
  updateGroup,
} from "../../src/services/groups.ts";
import { addMember } from "../../src/services/members.ts";
import { signIn } from "../../src/services/users.ts";
import { setup, type Setup } from "../helpers.ts";

const TODAY = "2026-11-19";

function house({ db, as }: Setup) {
  const ana = as("ana@example.com");
  const ben = as("ben@example.com");
  const group = createGroup(ana, { name: "House" });
  addMember(ana, group.id, { email: "ben@example.com" });
  const cy = addMember(ana, group.id, { name: "Cy", email: "cy@example.com" });
  const a = ana.user.memberId;
  const b = ben.user.memberId;
  return { db, as, ana, ben, cy, group, a, b, c: cy.id };
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

const dishes = (rotation: number[]) => ({
  name: "Dishes",
  instructions: "Load the dishwasher\nRun it",
  everyDays: 7,
  starts: "2026-11-16",
  rotation,
});

describe("chores", () => {
  it("are off until the group turns them on", () =>
    setup(({ ...fx }) => {
      const { ana, ben, group, a, b } = house(fx);
      expect(message(() => listChores(ana, group.id))).toBe(
        "400 Chores are turned off for this group",
      );
      updateGroup(ben, group.id, { chores: true });
      expect(listChores(ana, group.id, TODAY)).toEqual({
        chores: [],
        away: [],
      });
      const c = createChore(ana, group.id, dishes([a, b]), TODAY);
      expect(c.current).toMatchObject({ start: "2026-11-16", memberId: a });
      expect(c.turns[1]).toMatchObject({ start: "2026-11-23", memberId: b });
    }));

  it("validates the rotation and dates", () =>
    setup((fx) => {
      const { ana, group, a, b } = house(fx);
      updateGroup(ana, group.id, { chores: true });
      const eve = fx.as("eve@example.com");
      expect(
        message(() =>
          createChore(ana, group.id, dishes([a, eve.user.memberId])),
        ),
      ).toBe("400 Everyone in a chore's rotation must be in the group");
      expect(message(() => createChore(ana, group.id, dishes([])))).toBe(
        "400 rotation: Pick at least one person",
      );
      expect(message(() => createChore(ana, group.id, dishes([a, a])))).toBe(
        "400 Everyone takes one place",
      );
      expect(
        message(() =>
          createChore(ana, group.id, { ...dishes([a, b]), ends: "2026-01-01" }),
        ),
      ).toBe("400 The last turn can't start before the first");
      expect(message(() => listChores(eve, group.id))).toBe(
        "404 Group not found",
      );
    }));

  it("lets the chore's or group's creator edit and delete", () =>
    setup((fx) => {
      const { ana, ben, group, a, b } = house(fx);
      updateGroup(ana, group.id, { chores: true });
      const c = createChore(ana, group.id, dishes([a, b]), TODAY);
      expect(message(() => updateChore(ben, c.id, { name: "Plates" }))).toBe(
        "403 Only the person who added this chore or the group's creator can edit it",
      );
      const mine = createChore(ben, group.id, dishes([b, a]), TODAY);
      expect(updateChore(ana, mine.id, { name: "Pots" }, TODAY).name).toBe(
        "Pots",
      );
      expect(message(() => deleteChore(ben, c.id))).toMatch(/^403/);
      deleteChore(ben, mine.id);
      expect(listChores(ana, group.id, TODAY).chores.map((x) => x.id)).toEqual([
        c.id,
      ]);
      expect(
        listActivity(ana, { groupId: group.id }).map((x) => x.sentence),
      ).toContain('Ben deleted the chore "Pots"');
    }));

  it("skips time away; only yourself unless you created the group", () =>
    setup((fx) => {
      const { ana, ben, group, a, b, c } = house(fx);
      updateGroup(ana, group.id, { chores: true });
      const chore = createChore(ana, group.id, dishes([a, b, c]), TODAY);
      expect(
        message(() =>
          addAway(ben, group.id, {
            memberId: c,
            from: "2026-11-20",
            until: "2027-01-04",
          }),
        ),
      ).toBe("403 Only the group's creator can mark someone else away");
      const away = addAway(ana, group.id, {
        memberId: b,
        from: "2026-11-20",
        until: "2027-01-04",
      });
      const list = listChores(ben, group.id, TODAY);
      expect(list.away).toMatchObject([{ memberId: b, canEdit: true }]);
      const ids = list.chores[0]!.turns.slice(0, 4).map((t) => t.memberId);
      expect(ids).toEqual([a, c, a, c]);
      deleteAway(ben, away.id);
      expect(
        listChores(ben, group.id, TODAY)
          .chores[0]!.turns.slice(0, 3)
          .map((t) => t.memberId),
      ).toEqual([a, b, c]);
      expect(chore.id).toBeGreaterThan(0);
    }));

  it("swaps a turn with the other person's next one, and back", () =>
    setup((fx) => {
      const { ana, ben, group, a, b, c } = house(fx);
      updateGroup(ana, group.id, { chores: true });
      const chore = createChore(ben, group.id, dishes([a, b, c]), TODAY);
      // Cy (a placeholder) can't act; Ben isn't in Ana's turn and didn't create the group.
      const cyTurn = chore.turns[2]!;
      expect(
        message(() =>
          swapTurn(ben, chore.id, { turnStart: cyTurn.start, memberId: a }),
        ),
      ).toBe(
        "403 Only the two people swapping or the group's creator can swap turns",
      );
      const swapped = swapTurn(
        ben,
        chore.id,
        { turnStart: "2026-11-23", memberId: c },
        TODAY,
      );
      expect(
        swapped.turns.slice(0, 4).map((t) => [t.memberId, t.swappedFrom]),
      ).toEqual([
        [a, null],
        [c, b],
        [b, c],
        [a, null],
      ]);
      const back = swapTurn(
        ben,
        chore.id,
        { turnStart: "2026-11-23", memberId: b },
        TODAY,
      );
      expect(back.turns.slice(0, 3).map((t) => t.swappedFrom)).toEqual([
        null,
        null,
        null,
      ]);
      expect(
        message(() =>
          swapTurn(ana, chore.id, { turnStart: "2026-11-09", memberId: b }),
        ),
      ).toBe("400 That turn is over or isn't on the schedule");
      // Moving the start drops swaps, whose dates no longer line up.
      swapTurn(ben, chore.id, { turnStart: "2026-11-23", memberId: c }, TODAY);
      const moved = updateChore(ben, chore.id, { starts: "2026-11-17" }, TODAY);
      expect(moved.turns.every((t) => t.swappedFrom === null)).toBe(true);
    }));

  it("shows your turn on home, and follows a placeholder who signs up", () =>
    setup((fx) => {
      const { db, ana, group, a, c } = house(fx);
      updateGroup(ana, group.id, { chores: true });
      createChore(ana, group.id, dishes([c, a]), TODAY);
      addAway(ana, group.id, {
        memberId: c,
        from: "2026-12-01",
        until: "2026-12-15",
      });
      expect(myTurns(ana, listGroups(ana), TODAY)).toMatchObject([
        { chore: "Dishes", turn: { start: "2026-11-23", memberId: a } },
      ]);
      const cy = signIn(db, "cy@example.com");
      const ctx = { db, user: cy };
      expect(myTurns(ctx, listGroups(ctx), TODAY)).toMatchObject([
        { turn: { start: "2026-11-16", memberId: cy.memberId } },
      ]);
      expect(listChores(ctx, group.id, TODAY).away[0]!.memberId).toBe(
        cy.memberId,
      );
    }));
});
