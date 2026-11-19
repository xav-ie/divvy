import { describe, expect, it } from "vitest";
import { addDays, daysBetween, turns } from "../../src/domain/chores.ts";

const weekly = (rotation: number[], starts = "2026-11-16") => ({
  starts,
  everyDays: 7,
  ends: null,
  rotation,
});
const who = (ts: { memberId: number | null }[]) => ts.map((t) => t.memberId);
const none = new Map<string, number>();
const range = { from: "2026-01-01", until: "2027-01-01" };

describe("addDays", () => {
  it("crosses months, years and DST without drifting", () => {
    expect(addDays("2026-11-16", 6)).toBe("2026-11-22");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2027-03-08", 7)).toBe("2027-03-15");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-11-16", "2027-08-30")).toBe(287);
  });
});

describe("turns", () => {
  it("goes round the rotation with each turn's last day", () => {
    const ts = turns(weekly([1, 2, 3]), [], none, range);
    expect(ts.slice(0, 4)).toEqual([
      {
        start: "2026-11-16",
        end: "2026-11-22",
        memberId: 1,
        swappedFrom: null,
      },
      {
        start: "2026-11-23",
        end: "2026-11-29",
        memberId: 2,
        swappedFrom: null,
      },
      {
        start: "2026-11-30",
        end: "2026-12-06",
        memberId: 3,
        swappedFrom: null,
      },
      {
        start: "2026-12-07",
        end: "2026-12-13",
        memberId: 1,
        swappedFrom: null,
      },
    ]);
  });

  it("skips whoever is away and carries on in order", () => {
    const away = [{ memberId: 2, from: "2026-11-20", until: "2027-01-04" }];
    expect(
      who(turns(weekly([1, 2, 3, 4, 5]), away, none, range)).slice(0, 10),
    ).toEqual([1, 3, 4, 5, 1, 3, 4]);
    const back = turns(weekly([1, 2, 3, 4, 5]), away, none, {
      from: "2027-01-04",
      until: "2027-02-01",
    });
    expect(who(back)).toEqual([5, 1, 2, 3]);
  });

  it("pairs two chores with the same order, one starting on the other's last day", () => {
    const away = [{ memberId: 2, from: "2026-11-20", until: "2027-01-04" }];
    const dishes = turns(weekly([1, 2, 3]), away, none, range);
    const trash = turns(weekly([1, 2, 3], "2026-11-22"), away, none, range);
    for (let i = 0; i < dishes.length - 1; i++) {
      expect(trash[i]!.memberId).toBe(dishes[i]!.memberId);
      expect(trash[i]!.start).toBe(dishes[i]!.end);
    }
  });

  it("leaves a turn empty when everyone is away", () => {
    const away = [1, 2].map((memberId) => ({
      memberId,
      from: "2026-11-23",
      until: "2026-11-30",
    }));
    expect(who(turns(weekly([1, 2]), away, none, range)).slice(0, 4)).toEqual([
      1,
      null,
      2,
      1,
    ]);
  });

  it("swaps one turn without moving the rest", () => {
    const swaps = new Map([["2026-11-23", 3]]);
    const ts = turns(weekly([1, 2, 3]), [], swaps, range);
    expect(who(ts).slice(0, 4)).toEqual([1, 3, 3, 1]);
    expect(ts[1]!.swappedFrom).toBe(2);
  });

  it("returns turns overlapping the range and stops at the last start", () => {
    const ts = turns({ ...weekly([1, 2]), ends: "2026-12-07" }, [], none, {
      from: "2026-11-20",
      until: "2027-01-01",
    });
    expect(ts.map((t) => t.start)).toEqual([
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
      "2026-12-07",
    ]);
  });
});
