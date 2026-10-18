import type { Amounts, Cents, Debt, LocalDate, MemberId } from "./types.ts";

/** One thing that moves balances: an expense or a payment, as seen by the balance math. */
export type LedgerEntry =
  | {
      kind: "expense";
      id: number;
      groupId: number;
      date: LocalDate;
      /** Tiebreak for same-day ordering (ISO timestamp). */
      created: string;
      title: string;
      paid: Amounts;
      shares: Amounts;
    }
  | {
      kind: "payment";
      id: number;
      groupId: number;
      date: LocalDate;
      created: string;
      title: string;
      from: MemberId;
      to: MemberId;
      cents: Cents;
    };

/**
 * Who owes whom for one expense. Debtors (paid less than their share) are
 * matched to creditors (paid more) in member order, so every creditor gets
 * back exactly their surplus and nobody gains or loses a rounding cent.
 */
export function expenseDebts(paid: Amounts, shares: Amounts): Debt[] {
  const ids = [
    ...new Set([...Object.keys(paid), ...Object.keys(shares)].map(Number)),
  ].sort((a, b) => a - b);
  const net = ids.map((id): [MemberId, Cents] => [
    id,
    (paid[id] ?? 0) - (shares[id] ?? 0),
  ]);
  const creditors = net.filter(([, v]) => v > 0);
  const debtors = net
    .filter(([, v]) => v < 0)
    .map(([id, v]): [MemberId, Cents] => [id, -v]);
  const debts: Debt[] = [];
  let c = 0;
  for (const debtor of debtors) {
    while (debtor[1] > 0 && c < creditors.length) {
      const creditor = creditors[c]!;
      const cents = Math.min(debtor[1], creditor[1]);
      debts.push({ from: debtor[0], to: creditor[0], cents });
      debtor[1] -= cents;
      creditor[1] -= cents;
      if (creditor[1] === 0) c++;
    }
  }
  return debts;
}

/** Debts an entry creates. A payment from A to B means B now owes A. */
export function entryDebts(entry: LedgerEntry): Debt[] {
  if (entry.kind === "expense") return expenseDebts(entry.paid, entry.shares);
  return entry.cents
    ? [{ from: entry.to, to: entry.from, cents: entry.cents }]
    : [];
}

/** How much `other` owes `me` from these debts; negative means `me` owes `other`. */
export function netBetween(
  debts: Iterable<Debt>,
  me: MemberId,
  other: MemberId,
): Cents {
  let n = 0;
  for (const d of debts) {
    if (d.from === other && d.to === me) n += d.cents;
    else if (d.from === me && d.to === other) n -= d.cents;
  }
  return n;
}

/** Net debt for every pair with a nonzero balance, as `from` owes `to` (cents > 0). */
export function pairwise(debts: Iterable<Debt>): Debt[] {
  const net = new Map<string, Debt>();
  for (const d of debts) {
    const [a, b] = d.from < d.to ? [d.from, d.to] : [d.to, d.from];
    const key = `${a}:${b}`;
    const cur = net.get(key) ?? { from: a, to: b, cents: 0 };
    cur.cents += d.from === a ? d.cents : -d.cents;
    net.set(key, cur);
  }
  return [...net.values()]
    .filter((d) => d.cents !== 0)
    .map((d) =>
      d.cents > 0 ? d : { from: d.to, to: d.from, cents: -d.cents },
    );
}

/** Each member's overall position: positive = is owed, negative = owes. */
export function memberNets(debts: Iterable<Debt>): Map<MemberId, Cents> {
  const nets = new Map<MemberId, Cents>();
  for (const d of debts) {
    nets.set(d.to, (nets.get(d.to) ?? 0) + d.cents);
    nets.set(d.from, (nets.get(d.from) ?? 0) - d.cents);
  }
  return nets;
}

/**
 * Fewest-ish transfers that settle everyone: repeatedly match the biggest
 * debtor with the biggest creditor.
 */
export function simplify(nets: Map<MemberId, Cents>): Debt[] {
  const byAmount = (a: [MemberId, Cents], b: [MemberId, Cents]) =>
    b[1] - a[1] || a[0] - b[0];
  const debtors = [...nets]
    .filter(([, v]) => v < 0)
    .map(([id, v]): [MemberId, Cents] => [id, -v])
    .sort(byAmount);
  const creditors = [...nets].filter(([, v]) => v > 0).sort(byAmount);
  const out: Debt[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]!;
    const creditor = creditors[c]!;
    const cents = Math.min(debtor[1], creditor[1]);
    out.push({ from: debtor[0], to: creditor[0], cents });
    debtor[1] -= cents;
    creditor[1] -= cents;
    if (debtor[1] === 0) d++;
    if (creditor[1] === 0) c++;
  }
  return out;
}

export interface DrillLine {
  entry: LedgerEntry;
  /** How much this entry adds to what `other` owes `me` (negative: `me` owes more). */
  effectCents: Cents;
  /** What `other` owes `me` after this entry; the newest line equals the headline balance. */
  runningCents: Cents;
}

/** Oldest first by date, then creation time, then id. */
export function compareEntries(a: LedgerEntry, b: LedgerEntry): number {
  return (
    a.date.localeCompare(b.date) ||
    a.created.localeCompare(b.created) ||
    a.id - b.id
  );
}

/**
 * Every entry that changes the balance between `me` and `other`, newest
 * first, with its signed effect and the running total after it.
 */
export function drillDown(
  entries: Iterable<LedgerEntry>,
  me: MemberId,
  other: MemberId,
): DrillLine[] {
  const lines: DrillLine[] = [];
  let running = 0;
  for (const entry of [...entries].sort(compareEntries)) {
    const effectCents = netBetween(entryDebts(entry), me, other);
    if (!effectCents) continue;
    running += effectCents;
    lines.push({ entry, effectCents, runningCents: running });
  }
  return lines.reverse();
}
