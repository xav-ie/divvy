import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  allocate,
  formatCents,
  parseCents,
  splitSeed,
} from "../../src/domain/money.ts";
import { computeSplit, type SplitInput } from "../../src/domain/split.ts";
import {
  expenseDebts,
  memberNets,
  simplify,
} from "../../src/domain/balances.ts";
import type {
  Amounts,
  Cents,
  ExpenseItem,
  MemberId,
} from "../../src/domain/types.ts";

// Generators. Money is bounded to realistic magnitudes so property failures
// stay readable; correctness at 10^12 cents is covered by the round-trip.
const cents = fc.integer({ min: 0, max: 100_000_000 }); // up to $1M
const weight = fc.integer({ min: 0, max: 99 });
const seed = fc
  .string({ minLength: 0, maxLength: 24 })
  .filter((s) => !s.includes("|") || s === "");

const memberIds = fc.uniqueArray(fc.integer({ min: 1, max: 12 }), {
  minLength: 1,
  maxLength: 12,
});

/** Split `total` into k nonnegative integer parts (random cutpoints). */
function partition(total: number, k: number, rng: () => number): number[] {
  if (k === 0) return [];
  const cuts = Array.from({ length: k - 1 }, () =>
    Math.floor(rng() * (total + 1)),
  );
  cuts.push(0, total);
  cuts.sort((a, b) => a - b);
  const parts: number[] = [];
  for (let i = 0; i < k; i++) parts.push(cuts[i + 1]! - cuts[i]!);
  return parts;
}

// Deterministic rng adapter for partition() inside fast-check properties.
function rngFrom(seedNum: number): () => number {
  let s = seedNum || 1;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** Index that always lands in bounds (noUncheckedIndexedAccess-friendly). */
const at = <T>(xs: readonly T[], i: number): T => xs[i % xs.length]!;

/** Object.fromEntries with the numeric keys the domain types expect. */
const amountsOf = (pairs: Array<[number, number]>): Record<number, number> =>
  Object.fromEntries(pairs) as Record<number, number>;

describe("property: allocate", () => {
  it("conserves cents exactly: shares always sum to the total", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        memberIds,
        fc.array(weight, { minLength: 1, maxLength: 12 }),
        seed,
        (total, ids, ws, sd) => {
          const weights = ids.map((id, i) => [id, ws[i] ?? 0] as const);
          const out = allocate(total, weights, sd);
          const anyWeight = weights.some(([, w]) => w > 0);
          const sum = [...out.values()].reduce((a, b) => a + b, 0);
          if (!anyWeight || total === 0) {
            expect(sum).toBe(0);
            expect([...out.values()].every((v) => v === 0)).toBe(true);
          } else {
            expect(sum).toBe(total);
            // No share exceeds the total, and all nonzero shares share its sign.
            for (const v of out.values()) {
              expect(Math.abs(v)).toBeLessThanOrEqual(Math.abs(total));
              if (v !== 0) expect(Math.sign(v)).toBe(Math.sign(total));
            }
          }
        },
      ),
    );
  });

  it("zero weights get zero cents", () => {
    fc.assert(
      fc.property(cents, memberIds, seed, (total, ids, sd) => {
        const weights = ids.map((id) => [id, 0] as const);
        const out = allocate(total, weights, sd);
        expect([...out.values()].every((v) => v === 0)).toBe(true);
      }),
    );
  });

  it("is deterministic for identical input", () => {
    fc.assert(
      fc.property(
        cents,
        memberIds,
        fc.array(weight, { minLength: 1, maxLength: 12 }),
        seed,
        (total, ids, ws, sd) => {
          const weights = ids.map((id, i) => [id, ws[i] ?? 0] as const);
          const a = allocate(total, weights, sd);
          const b = allocate(total, weights, sd);
          expect([...a.entries()]).toEqual([...b.entries()]);
        },
      ),
    );
  });
});

describe("property: computeSplit", () => {
  const itemsArb: fc.Arbitrary<ExpenseItem[]> = fc
    .record({
      n: fc.integer({ min: 1, max: 6 }),
      ids: memberIds,
      centsPerItem: fc.array(cents, { minLength: 1, maxLength: 6 }),
      kind: fc.constantFrom("equal", "shares", "percent"),
      w: fc.array(fc.integer({ min: 0, max: 9 }), {
        minLength: 1,
        maxLength: 6,
      }),
      p: fc.array(fc.integer({ min: 0, max: 100 }), {
        minLength: 1,
        maxLength: 6,
      }),
      qty: fc.array(fc.integer({ min: 1, max: 12 }), {
        minLength: 1,
        maxLength: 6,
      }),
    })
    .map(({ n, ids, centsPerItem, kind, w, p, qty }) => {
      const chosen = ids.slice(0, Math.max(1, Math.min(n, ids.length)));
      const items: ExpenseItem[] = [];
      for (let i = 0; i < n; i++) {
        const who = chosen[(i * 3 + 1) % chosen.length]!;
        let split: Record<number, number>;
        if (kind === "equal") {
          split = amountsOf(chosen.map((id) => [id, 1] as [number, number]));
        } else if (kind === "shares") {
          split = amountsOf(
            chosen.map((id, j) => [id, at(w, j)] as [number, number]),
          );
          if (Object.values(split).every((x) => x === 0)) split[who] = 1;
        } else {
          // percent: cut 100 among the chosen members.
          const parts = partition(100, chosen.length, rngFrom(at(p, i) + 7));
          split = amountsOf(
            chosen.map((id, j) => [id, parts[j]!] as [number, number]),
          );
        }
        items.push({
          name: `item ${i}`,
          quantity: at(qty, i),
          unitCents: at(centsPerItem, i),
          splitType: kind,
          split,
        });
      }
      return items;
    });

  it("conserves cents: shares sum to the total, no negative shares, deterministic", () => {
    fc.assert(
      fc.property(
        itemsArb,
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        seed,
        fc.option(fc.integer({ min: 1, max: 12 }), { nil: undefined }),
        (items, tax, tip, discount, sd, creator) => {
          const input: SplitInput = {
            items,
            taxCents: tax,
            tipCents: tip,
            discountCents: discount,
            seed: sd,
            creator,
          };
          const a = computeSplit(input);
          const b = computeSplit(input);
          expect(a.shares).toEqual(b.shares); // deterministic
          expect(a.totalCents).toBe(a.subtotalCents + tax + tip - discount);
          if (a.errors.length > 0) return; // only assert on valid splits
          const sum = Object.values(a.shares).reduce((x, y) => x + y, 0);
          expect(sum).toBe(a.totalCents);
          expect(Object.values(a.shares).every((v) => v >= 0)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("the odd cent goes to the bill creator on an equal split", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        seed,
        (n, per, sd) => {
          const total = per * n + 1; // guaranteed remainder of 1
          const ids = Array.from({ length: n }, (_, i) => i + 1);
          const creator = ids[ids.length - 1]!;
          const items: ExpenseItem[] = [
            {
              name: "bill",
              quantity: 1,
              unitCents: total,
              splitType: "equal",
              split: Object.fromEntries(ids.map((id) => [id, 1])),
            },
          ];
          const r = computeSplit({
            items,
            taxCents: 0,
            tipCents: 0,
            discountCents: 0,
            seed: sd,
            creator,
          });
          expect(r.errors).toEqual([]);
          expect(r.shares[creator]!).toBe(per + 1); // ceil
          for (const id of ids) {
            if (id === creator) continue;
            expect(r.shares[id]!).toBe(per); // floor
          }
          const sum = Object.values(r.shares).reduce((x, y) => x + y, 0);
          expect(sum).toBe(total);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("property: balances", () => {
  it("nets sum to zero for any paid/shares pair with equal totals", () => {
    fc.assert(
      fc.property(
        memberIds,
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.integer({ min: 1, max: 2_000_000_000 }),
        (ids, total, seedNum) => {
          const rng = rngFrom(seedNum);
          const paidParts = partition(total, ids.length, rng);
          const shareParts = partition(total, ids.length, rng);
          const paid: Amounts = amountsOf(
            ids.map((id, i) => [id, paidParts[i]!] as [number, number]),
          );
          const shares: Amounts = amountsOf(
            ids.map((id, i) => [id, shareParts[i]!] as [number, number]),
          );
          const nets = memberNets(expenseDebts(paid, shares));
          const sum = [...nets.values()].reduce((a, b) => a + b, 0);
          expect(sum).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("simplify settles every net exactly, never inflates debt, no self-payments", () => {
    fc.assert(
      fc.property(
        memberIds,
        fc.array(fc.integer({ min: -100_000, max: 100_000 }), {
          minLength: 1,
          maxLength: 12,
        }),
        (ids, amounts) => {
          // Force the nets to sum to zero by fixing the last member.
          const raw = ids.map(
            (id, i) => [id, at(amounts, i)] as [MemberId, Cents],
          );
          const sumOthers = raw.slice(0, -1).reduce((a, [, v]) => a + v, 0);
          raw[raw.length - 1]![1] = sumOthers === 0 ? 0 : -sumOthers;
          const nets = new Map(raw);
          const settlements = simplify(nets);
          const settled = new Map<MemberId, Cents>(raw.map(([id]) => [id, 0]));
          for (const s of settlements) {
            expect(s.from).not.toBe(s.to);
            expect(s.cents).toBeGreaterThan(0);
            settled.set(s.from, (settled.get(s.from) ?? 0) - s.cents);
            settled.set(s.to, (settled.get(s.to) ?? 0) + s.cents);
          }
          expect([...settled.entries()]).toEqual([...nets.entries()]);
          const moved = settlements.reduce((a, s) => a + s.cents, 0);
          const owed = [...nets.values()]
            .filter((v) => v > 0)
            .reduce((a, b) => a + b, 0);
          expect(moved).toBeLessThanOrEqual(owed);
          if (owed === 0) expect(settlements).toEqual([]);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("property: money formatting", () => {
  it("parseCents(formatCents(cents)) round-trips", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000_00 }), (c) => {
        expect(parseCents(formatCents(c))).toBe(c);
      }),
      { numRuns: 500 },
    );
  });

  it("splitSeed is just date|title (no hidden state)", () => {
    expect(splitSeed("2026-10-01", "Groceries")).toBe("2026-10-01|Groceries");
  });
});
