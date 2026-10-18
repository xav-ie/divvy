import { describe, expect, it } from "vitest";
import { computeSplit, payerErrors } from "../../src/domain/split.ts";
import type { ExpenseItem } from "../../src/domain/types.ts";

const [ANA, BEN, CY, DEE] = [1, 2, 3, 4];
const solo = (name: string, cents: number, who: number): ExpenseItem => ({
  name,
  quantity: 1,
  unitCents: cents,
  splitType: "equal",
  split: { [who]: 1 },
});

describe("computeSplit", () => {
  it("splits the restaurant bill with proportional tax and tip", () => {
    const items: ExpenseItem[] = [
      solo("Ana main", 1800, ANA),
      solo("Ben main", 1600, BEN),
      solo("Cy main", 1400, CY),
      solo("Dee main", 2600, DEE),
      {
        name: "Nachos",
        quantity: 1,
        unitCents: 1200,
        splitType: "equal",
        split: { [ANA]: 1, [BEN]: 1, [CY]: 1, [DEE]: 1 },
      },
      solo("Ana drinks", 1100, ANA),
      solo("Ben drinks", 700, BEN),
    ];
    // 8% tax and 20% tip on the $104.00 pre-tax subtotal.
    const r = computeSplit({
      items,
      taxCents: 832,
      tipCents: 2080,
      discountCents: 0,
    });
    expect(r.errors).toEqual([]);
    expect(r.totalCents).toBe(13312);
    expect(r.shares).toEqual({
      [ANA]: 4096,
      [BEN]: 3328,
      [CY]: 2176,
      [DEE]: 3712,
    });
  });

  it("splits $10 equally three ways as 3.34/3.33/3.33", () => {
    const r = computeSplit({
      items: [
        {
          name: "Pizza",
          quantity: 1,
          unitCents: 1000,
          splitType: "equal",
          split: { 1: 1, 2: 1, 3: 1 },
        },
      ],
      taxCents: 0,
      tipCents: 0,
      discountCents: 0,
    });
    expect(r.shares).toEqual({ 1: 334, 2: 333, 3: 333 });
  });

  it("handles percent, exact, shares and quantity", () => {
    const r = computeSplit({
      items: [
        {
          name: "Rent",
          quantity: 1,
          unitCents: 100000,
          splitType: "percent",
          split: { 1: 60, 2: 40 },
        },
        {
          name: "Wine",
          quantity: 2,
          unitCents: 1500,
          splitType: "exact",
          split: { 1: 1000, 2: 2000 },
        },
        {
          name: "Bread",
          quantity: 1,
          unitCents: 900,
          splitType: "shares",
          split: { 1: 2, 2: 1 },
        },
      ],
      taxCents: 0,
      tipCents: 0,
      discountCents: 0,
    });
    expect(r.errors).toEqual([]);
    expect(r.subtotalCents).toBe(100000 + 3000 + 900);
    expect(r.shares).toEqual({ 1: 60000 + 1000 + 600, 2: 40000 + 2000 + 300 });
  });

  it("applies discounts proportionally and keeps the sum exact", () => {
    const r = computeSplit({
      items: [solo("A", 1000, 1), solo("B", 2000, 2)],
      taxCents: 0,
      tipCents: 0,
      discountCents: 100,
    });
    expect(r.totalCents).toBe(2900);
    expect(r.shares).toEqual({ 1: 967, 2: 1933 });
  });

  it("explains invalid splits", () => {
    const r = computeSplit({
      items: [
        {
          name: "Rent",
          quantity: 1,
          unitCents: 1000,
          splitType: "percent",
          split: { 1: 60, 2: 30 },
        },
        {
          name: "Wine",
          quantity: 1,
          unitCents: 1000,
          splitType: "exact",
          split: { 1: 300 },
        },
        {
          name: "",
          quantity: 1,
          unitCents: 500,
          splitType: "equal",
          split: {},
        },
      ],
      taxCents: 0,
      tipCents: 0,
      discountCents: 0,
    });
    expect(r.errors).toEqual([
      '"Rent" percentages add up to 90%, they must total 100%',
      '"Wine" amounts add up to $3.00 but the item is $10.00 ($7.00 left)',
      "Item 3 isn't split between anyone",
    ]);
  });

  it("rejects a discount bigger than the bill", () => {
    const r = computeSplit({
      items: [solo("A", 100, 1)],
      taxCents: 0,
      tipCents: 0,
      discountCents: 200,
    });
    expect(r.errors).toEqual([
      "The discount ($2.00) can't be more than the bill",
    ]);
  });
});

describe("payerErrors", () => {
  it("requires payments to cover the total", () => {
    expect(payerErrors({ 1: 1000 }, 1000)).toEqual([]);
    expect(payerErrors({ 1: 500, 2: 300 }, 1000)).toEqual([
      "Paid amounts add up to $8.00 but the total is $10.00 ($2.00 left)",
    ]);
    expect(payerErrors({}, 1000)).toEqual(["Someone has to have paid"]);
  });
});

describe("zero priced items", () => {
  it("refuses tax or tip on items that cost nothing", () => {
    const r = computeSplit({
      items: [
        {
          name: "Free",
          quantity: 1,
          unitCents: 0,
          splitType: "equal",
          split: { 1: 1, 2: 1 },
        },
      ],
      taxCents: 100,
      tipCents: 0,
      discountCents: 0,
    });
    expect(r.errors).toEqual(["Add a price to at least one item"]);
  });
});

describe("leftover cents", () => {
  const members = [1, 2, 3, 4, 5];
  const bill = (i: number) => {
    const total = 5000 + 1 + (i % 4); // remainders 1..4 cents
    return {
      total,
      input: {
        items: [
          {
            name: "Bill",
            quantity: 1,
            unitCents: total,
            splitType: "equal" as const,
            split: Object.fromEntries(members.map((m) => [m, 1])),
          },
        ],
        taxCents: 0,
        tipCents: 0,
        discountCents: 0,
        seed: `2026-01-${String((i % 28) + 1).padStart(2, "0")}|Bill ${i}`,
      },
    };
  };

  it("spread over members across bills and stay put on recompute", () => {
    const extra = new Map(members.map((m) => [m, 0]));
    let given = 0;
    for (let i = 0; i < 100; i++) {
      const { total, input } = bill(i);
      const { shares } = computeSplit(input);
      expect(computeSplit(input).shares).toEqual(shares);
      for (const m of members) {
        const e = shares[m]! - Math.floor(total / 5);
        extra.set(m, extra.get(m)! + e);
        given += e;
      }
    }
    const fair = given / members.length;
    for (const m of members) {
      expect(extra.get(m)!).toBeGreaterThan(fair * 0.7);
      expect(extra.get(m)!).toBeLessThan(fair * 1.3);
    }
  });
});

describe("who takes the odd cent", () => {
  const three = (creator?: number, payers?: Record<number, number>) =>
    computeSplit({
      items: [
        {
          name: "Groceries",
          quantity: 1,
          unitCents: 26812,
          splitType: "equal",
          split: { 1: 1, 2: 1, 3: 1 },
        },
      ],
      taxCents: 0,
      tipCents: 0,
      discountCents: 0,
      seed: "2026-10-01|Groceries",
      creator,
      payers,
    }).shares;

  it("goes to the creator when they share it", () => {
    for (const creator of [1, 2, 3])
      expect(three(creator, { 1: 26812 })[creator]).toBe(8938);
    expect(Object.values(three(2))).toEqual([8937, 8938, 8937]);
  });

  it("else to the top payer who shares it, else the seeded spread", () => {
    // Creator 9 isn't in the split; member 3 paid most.
    expect(three(9, { 1: 10000, 3: 16812 })[3]).toBe(8938);
    // Tie on the top payment: lowest id.
    expect(three(9, { 2: 13406, 3: 13406 })[2]).toBe(8938);
    // Nobody eligible: unchanged seeded result.
    expect(three(9, { 9: 26812 })).toEqual(three(undefined, undefined));
  });

  it("also covers tax and tip spread", () => {
    const r = computeSplit({
      items: [
        {
          name: "Dinner",
          quantity: 1,
          unitCents: 10000,
          splitType: "equal",
          split: { 1: 1, 2: 1, 3: 1 },
        },
      ],
      taxCents: 801,
      tipCents: 0,
      discountCents: 0,
      creator: 3,
    });
    expect(r.shares).toEqual({ 1: 3600, 2: 3600, 3: 3601 });
  });
});
