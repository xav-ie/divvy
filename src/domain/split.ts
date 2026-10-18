import { allocate, formatCents, roundCents, sumCents } from "./money.ts";
import type {
  Adjustments,
  Amounts,
  Cents,
  ExpenseItem,
  MemberId,
} from "./types.ts";

export interface SplitInput {
  items: ExpenseItem[];
  taxCents: Cents;
  tipCents: Cents;
  discountCents: Cents;
  /** Breaks leftover-cent ties fairly across bills; see `splitSeed`. */
  seed?: string;
  /** Who added the expense: they take the leftover cent when sharing it. */
  creator?: MemberId;
  /** Who paid: otherwise the top payer (lowest id on ties) takes it when sharing. */
  payers?: Amounts;
}

export interface SplitResult {
  subtotalCents: Cents;
  totalCents: Cents;
  /** Each member's share of the total; sums to totalCents. Best effort when `errors` is non-empty. */
  shares: Amounts;
  /** Human-readable problems; empty means the split is valid. */
  errors: string[];
}

/** Quantity times unit price, rounded to the cent. */
export function lineCents(
  item: Pick<ExpenseItem, "quantity" | "unitCents">,
): Cents {
  return roundCents(item.quantity * item.unitCents);
}

function itemLabel(item: ExpenseItem, i: number): string {
  return item.name.trim() ? `"${item.name.trim()}"` : `Item ${i + 1}`;
}

function entries(split: Record<MemberId, number>): Array<[MemberId, number]> {
  return Object.entries(split)
    .map(([id, v]): [MemberId, number] => [Number(id), v])
    .filter(([, v]) => v > 0);
}

/** Tax, tip and discount in cents; percents apply to the item subtotal. */
export function adjustmentCents(
  items: ReadonlyArray<Pick<ExpenseItem, "quantity" | "unitCents">>,
  a: Adjustments,
): { taxCents: Cents; tipCents: Cents; discountCents: Cents } {
  const subtotal = sumCents(items.map(lineCents));
  const cents = (mode: Adjustments["taxMode"], value: number) =>
    mode === "percent" ? roundCents((subtotal * value) / 100) : value;
  return {
    taxCents: cents(a.taxMode, a.taxValue),
    tipCents: cents(a.tipMode, a.tipValue),
    discountCents: cents(a.discountMode, a.discountValue),
  };
}

/**
 * Fractional cents each member carries for one item, plus a problem if the
 * split doesn't add up. Exact splits are whole cents; others are proportional.
 */
function itemCarry(
  item: ExpenseItem,
  line: Cents,
  label: string,
): { carry: Map<MemberId, number>; problem?: string } {
  const parts = entries(item.split);
  const carry = new Map<MemberId, number>();
  if (Object.values(item.split).some((v) => !Number.isFinite(v) || v < 0)) {
    return { carry, problem: `${label} has a negative or invalid split value` };
  }
  if (parts.length === 0)
    return { carry, problem: `${label} isn't split between anyone` };
  const total = sumCents(parts.map(([, v]) => v));
  let problem: string | undefined;
  switch (item.splitType) {
    case "exact": {
      if (parts.some(([, v]) => !Number.isInteger(v)))
        problem = `${label} exact amounts must be whole cents`;
      else if (total !== line) {
        const left = line - total;
        problem = `${label} amounts add up to ${formatCents(total)} but the item is ${formatCents(line)} (${formatCents(left)} ${left > 0 ? "left" : "too much"})`;
      }
      break;
    }
    case "percent": {
      if (Math.abs(total - 100) > 0.001) {
        problem = `${label} percentages add up to ${+total.toFixed(3)}%, they must total 100%`;
      }
      break;
    }
    case "equal":
    case "shares":
      break;
  }
  const weight = (v: number) => (item.splitType === "equal" ? 1 : v);
  const weightSum = parts.reduce((s, [, v]) => s + weight(v), 0);
  for (const [id, v] of parts) carry.set(id, (line * weight(v)) / weightSum);
  return { carry, problem };
}

/**
 * Who absorbs a rounding cent: the creator if they share the expense, else
 * the payer who paid most (lowest id on ties) if they share it, else nobody
 * in particular (the seeded spread decides).
 */
export function oddCentsTo(
  sharing: ReadonlyMap<MemberId, number>,
  creator: MemberId | undefined,
  payers: Amounts | undefined,
): MemberId | undefined {
  const shares = (id: MemberId | undefined) =>
    id !== undefined && (sharing.get(id) ?? 0) > 0;
  if (shares(creator)) return creator;
  const top = Object.entries(payers ?? {})
    .map(([id, c]): [MemberId, Cents] => [Number(id), c])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  return shares(top) ? top : undefined;
}

/**
 * Each member's share of an expense. Items split per their split type; tax,
 * tip and discount spread proportionally to what each member's items cost.
 * Leftover cents go to oddCentsTo's pick first, then by largest remainder,
 * so shares sum to the total exactly.
 */
export function computeSplit(input: SplitInput): SplitResult {
  const errors: string[] = [];
  const carry = new Map<MemberId, number>();
  let subtotal = 0;

  if (input.items.length === 0) errors.push("Add at least one item");
  input.items.forEach((item, i) => {
    const label = itemLabel(item, i);
    if (!(item.quantity > 0) || !Number.isFinite(item.quantity)) {
      errors.push(`${label} needs a quantity above 0`);
      return;
    }
    if (!Number.isInteger(item.unitCents) || item.unitCents < 0) {
      errors.push(`${label} needs a price of $0.00 or more`);
      return;
    }
    const line = lineCents(item);
    subtotal += line;
    const { carry: c, problem } = itemCarry(item, line, label);
    if (problem) errors.push(problem);
    for (const [id, v] of c) carry.set(id, (carry.get(id) ?? 0) + v);
  });

  for (const [name, v] of [
    ["Tax", input.taxCents],
    ["Tip", input.tipCents],
    ["Discount", input.discountCents],
  ] as const) {
    if (!Number.isInteger(v) || v < 0)
      errors.push(`${name} must be $0.00 or more`);
  }

  const total =
    subtotal + input.taxCents + input.tipCents - input.discountCents;
  if (total <= 0 && errors.length === 0) {
    errors.push(
      input.discountCents > 0
        ? `The discount (${formatCents(input.discountCents)}) can't be more than the bill`
        : "The total must be more than $0.00",
    );
  }

  if (subtotal === 0 && total > 0 && errors.length === 0)
    errors.push("Add a price to at least one item");

  const shares: Amounts = {};
  const favor = oddCentsTo(carry, input.creator, input.payers);
  for (const [id, v] of allocate(
    Math.max(total, 0),
    [...carry],
    input.seed,
    favor,
  ))
    shares[id] = v;
  if (errors.length === 0 && sumCents(Object.values(shares)) !== total)
    errors.push("The split doesn't cover the whole total");
  return { subtotalCents: subtotal, totalCents: total, shares, errors };
}

/** Problems with who paid what; empty when payers cover exactly `totalCents`. */
export function payerErrors(payers: Amounts, totalCents: Cents): string[] {
  const values = Object.values(payers);
  if (values.some((v) => !Number.isInteger(v) || v < 0))
    return ["Paid amounts must be whole cents, $0.00 or more"];
  const paid = sumCents(values);
  if (paid <= 0) return ["Someone has to have paid"];
  if (paid !== totalCents) {
    const left = totalCents - paid;
    return [
      `Paid amounts add up to ${formatCents(paid)} but the total is ${formatCents(totalCents)} (${formatCents(left)} ${left > 0 ? "left" : "too much"})`,
    ];
  }
  return [];
}
