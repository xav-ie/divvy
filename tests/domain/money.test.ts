import { describe, expect, it } from "vitest";
import { allocate, formatCents, parseCents } from "../../src/domain/money.ts";

describe("money", () => {
  it("allocates $10 three ways as 3.34/3.33/3.33", () => {
    const out = allocate(1000, [
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect([...out.values()]).toEqual([334, 333, 333]);
  });

  it("gives leftover cents to the largest remainders and always sums to the total", () => {
    const out = allocate(100, [
      [1, 1],
      [2, 2],
      [3, 4],
    ]);
    expect([...out.values()].reduce((a, b) => a + b)).toBe(100);
    expect(out.get(3)).toBe(57);
  });

  it("allocates negative totals symmetrically", () => {
    expect([
      ...allocate(-1000, [
        [1, 1],
        [2, 1],
        [3, 1],
      ]).values(),
    ]).toEqual([-334, -333, -333]);
  });

  it("returns zeros when there is no weight", () => {
    expect([...allocate(500, [[1, 0]]).values()]).toEqual([0]);
  });

  it("formats and parses", () => {
    expect(formatCents(123450)).toBe("$1,234.50");
    expect(formatCents(-5)).toBe("$0.05");
    expect(parseCents("12.5")).toBe(1250);
    expect(parseCents("$1,234.56")).toBe(123456);
    expect(parseCents(".07")).toBe(7);
    expect(parseCents("")).toBeNull();
    expect(parseCents("1.234")).toBeNull();
    expect(parseCents("abc")).toBeNull();
  });
});
