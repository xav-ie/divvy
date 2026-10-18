import { describe, expect, it } from "vitest";
import {
  drillDown,
  entryDebts,
  expenseDebts,
  memberNets,
  pairwise,
  simplify,
  type LedgerEntry,
} from "../../src/domain/balances.ts";
import {
  debtSentence,
  drillSentence,
  overallSentence,
} from "../../src/domain/words.ts";

const [ANA, BEN, CY] = [1, 2, 3];
const names = { [ANA]: "Ana", [BEN]: "Ben", [CY]: "Cy" };

const expense = (
  id: number,
  date: string,
  paid: Record<number, number>,
  shares: Record<number, number>,
): LedgerEntry => ({
  kind: "expense",
  id,
  groupId: 1,
  date,
  created: `${date}T00:00:00Z`,
  title: `Bill ${id}`,
  paid,
  shares,
});

describe("expenseDebts", () => {
  it("makes everyone who paid less owe the payer", () => {
    expect(
      expenseDebts({ [ANA]: 6000 }, { [ANA]: 2000, [BEN]: 2000, [CY]: 2000 }),
    ).toEqual([
      { from: BEN, to: ANA, cents: 2000 },
      { from: CY, to: ANA, cents: 2000 },
    ]);
  });

  it("matches a debt to the people who paid more", () => {
    // Ana paid 40, Ben paid 20, shares 20 each: Cy owes 20, Ana is up 20, Ben is up 0.
    expect(
      expenseDebts(
        { [ANA]: 4000, [BEN]: 2000 },
        { [ANA]: 2000, [BEN]: 2000, [CY]: 2000 },
      ),
    ).toEqual([{ from: CY, to: ANA, cents: 2000 }]);
    // Ana paid 45, Ben 15, shares 20 each: Ana +25; Ben -5 and Cy -20 both owe Ana.
    const debts = expenseDebts(
      { [ANA]: 4500, [BEN]: 1500 },
      { [ANA]: 2000, [BEN]: 2000, [CY]: 2000 },
    );
    expect(debts).toEqual([
      { from: BEN, to: ANA, cents: 500 },
      { from: CY, to: ANA, cents: 2000 },
    ]);
  });
});

describe("expenseDebts with several payers", () => {
  it("gives each creditor exactly their surplus", () => {
    // $10.01 among five: shares 201, 200, 200, 200, 200; members 1 and 2 paid 500 and 501.
    const shares = { 1: 201, 2: 200, 3: 200, 4: 200, 5: 200 };
    const paid = { 1: 500, 2: 501 };
    const nets = memberNets(expenseDebts(paid, shares));
    expect(Object.fromEntries(nets)).toEqual({
      1: 299,
      2: 301,
      3: -200,
      4: -200,
      5: -200,
    });
  });
});

describe("pairwise, nets and simplify", () => {
  const entries = [
    expense(
      1,
      "2026-01-01",
      { [ANA]: 3000 },
      { [ANA]: 1000, [BEN]: 1000, [CY]: 1000 },
    ),
    expense(
      2,
      "2026-01-02",
      { [BEN]: 3000 },
      { [ANA]: 1000, [BEN]: 1000, [CY]: 1000 },
    ),
    {
      kind: "payment",
      id: 1,
      groupId: 1,
      date: "2026-01-03",
      created: "2026-01-03T00:00:00Z",
      title: "",
      from: CY,
      to: ANA,
      cents: 500,
    } as const,
  ];
  const debts = entries.flatMap(entryDebts);

  it("nets each pair", () => {
    expect(pairwise(debts)).toEqual([
      { from: CY, to: ANA, cents: 500 },
      { from: CY, to: BEN, cents: 1000 },
    ]);
  });

  it("simplifies to the fewest transfers", () => {
    const nets = memberNets(debts);
    expect(Object.fromEntries(nets)).toEqual({
      [ANA]: 500,
      [BEN]: 1000,
      [CY]: -1500,
    });
    expect(simplify(nets)).toEqual([
      { from: CY, to: BEN, cents: 1000 },
      { from: CY, to: ANA, cents: 500 },
    ]);
  });

  it("simplifies a cycle away", () => {
    const nets = memberNets([
      { from: ANA, to: BEN, cents: 100 },
      { from: BEN, to: CY, cents: 100 },
      { from: CY, to: ANA, cents: 100 },
    ]);
    expect(simplify(nets)).toEqual([]);
  });

  it("drills down newest first with a running total ending at the balance", () => {
    const lines = drillDown(entries, ANA, CY);
    expect(
      lines.map((l) => [
        l.entry.kind,
        l.entry.id,
        l.effectCents,
        l.runningCents,
      ]),
    ).toEqual([
      ["payment", 1, -500, 500],
      ["expense", 1, 1000, 1000],
    ]);
    const balance = pairwise(debts).find(
      (d) => d.from === CY && d.to === ANA,
    )!.cents;
    expect(lines[0]!.runningCents).toBe(balance);
    expect(drillSentence(names, ANA, CY, lines[1]!)).toBe(
      "Bill 1: you paid $30.00, your share $10.00, Cy's share $10.00, so Cy owes you $10.00",
    );
    expect(drillSentence(names, ANA, CY, lines[0]!)).toBe("Cy paid you $5.00");
    expect(drillSentence(names, CY, ANA, lines[1]!)).toBeTypeOf("string");
  });
});

describe("sentences", () => {
  it("always names a direction", () => {
    expect(debtSentence(names, ANA, { from: BEN, to: ANA, cents: 4210 })).toBe(
      "Ben owes you $42.10",
    );
    expect(debtSentence(names, ANA, { from: ANA, to: BEN, cents: 800 })).toBe(
      "You owe Ben $8.00",
    );
    expect(debtSentence(names, ANA, { from: BEN, to: CY, cents: 500 })).toBe(
      "Ben owes Cy $5.00",
    );
    expect(debtSentence(names, ANA, { from: CY, to: ANA, cents: 0 })).toBe(
      "You and Cy are settled up",
    );
    expect(overallSentence(12040)).toBe("Overall, you're owed $120.40");
    expect(overallSentence(-800)).toBe("Overall, you owe $8.00");
  });
});

describe("simplifySentence", () => {
  it("keeps names capitalized and reads naturally", async () => {
    const { simplifySentence } = await import("../../src/domain/words.ts");
    const n = { [ANA]: "Ana", [BEN]: "Xavier" };
    const say = (raw: number, simplified: number) =>
      simplifySentence(n, ANA, BEN, "House", raw, simplified);
    expect(say(0, -52400)).toBe(
      "Simplified in House: you pay Xavier $524.00 directly instead of through other members",
    );
    expect(say(800, 0)).toBe(
      "Simplified in House: you and Xavier don't pay each other; Xavier's $8.00 to you goes through other members",
    );
    expect(say(-300, -500)).toBe(
      "Simplified in House: you pay Xavier $5.00 instead of $3.00, settling other debts along the way",
    );
    expect(say(-300, 500)).toBe(
      "Simplified in House: Xavier pays you $5.00 instead of you paying Xavier $3.00",
    );
  });
});
