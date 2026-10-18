import type { Db } from "../db/connection.ts";
import { listExpenses } from "../db/expenses.ts";
import {
  groupMembers,
  groupsForMember,
  isGroupMember,
  type Group,
} from "../db/groups.ts";
import { todayLocal } from "../domain/recurring.ts";
import { getMembers } from "../db/members.ts";
import { listPayments } from "../db/payments.ts";
import {
  drillDown as drill,
  entryDebts,
  memberNets,
  netBetween,
  pairwise,
  simplify,
  type LedgerEntry,
} from "../domain/balances.ts";
import type { Cents, Debt, LocalDate, MemberId } from "../domain/types.ts";
import {
  balanceSentence,
  debtSentence,
  drillSentence,
  simplifySentence,
  netSentence,
  overallSentence,
} from "../domain/words.ts";
import { requireGroup, type Ctx } from "./context.ts";
import { notFound } from "./errors.ts";
import { parse } from "./parse.ts";
import { id } from "./schemas.ts";

/** Every expense and payment in these groups, as balance math sees them. */
export function ledger(db: Db, groupIds: number[]): LedgerEntry[] {
  const expenses = listExpenses(db, groupIds).map((e): LedgerEntry => ({
    kind: "expense",
    id: e.id,
    groupId: e.groupId,
    date: e.date,
    created: e.created,
    title: e.title,
    paid: e.payers,
    shares: e.shares,
  }));
  const payments = listPayments(db, groupIds).map((p): LedgerEntry => ({
    kind: "payment",
    id: p.id,
    groupId: p.groupId,
    date: p.date,
    created: p.created,
    title: p.note,
    from: p.fromMember,
    to: p.toMember,
    cents: p.cents,
  }));
  return [...expenses, ...payments];
}

/**
 * Debts as each group presents them: every expense and payment, or for groups
 * with simplify on, the fewest transfers that settle that group.
 */
export function effectiveDebts(
  entries: LedgerEntry[],
  groups: Group[],
): Debt[] {
  return groups.flatMap((g) => {
    const debts = entries.filter((e) => e.groupId === g.id).flatMap(entryDebts);
    return g.simplify ? simplify(memberNets(debts)) : debts;
  });
}

/** Names for every member these entries mention (including former members). */
function namesFor(
  db: Db,
  entries: LedgerEntry[],
  extra: MemberId[] = [],
): Map<MemberId, string> {
  const ids = new Set(extra);
  for (const e of entries)
    for (const d of entryDebts(e)) ids.add(d.from).add(d.to);
  return new Map(getMembers(db, [...ids]).map((m) => [m.id, m.name]));
}

/** A balance between the viewer and one person: positive `cents` means they owe the viewer. */
export interface PersonBalance {
  memberId: MemberId;
  name: string;
  cents: Cents;
  /** "Ana owes you $42.10", "You owe Ben $8.00", "You and Cy are settled up". */
  sentence: string;
}

export interface HomeSummary {
  /** Positive: the viewer is owed overall. */
  overallCents: Cents;
  /** "Overall, you're owed $120.40". */
  sentence: string;
  /** People with a nonzero balance with the viewer across all groups, largest first. */
  people: PersonBalance[];
}

/** The viewer's position across all their groups. */
export function homeSummary(ctx: Ctx): HomeSummary {
  const me = ctx.user.memberId;
  const groups = groupsForMember(ctx.db, me);
  const entries = ledger(
    ctx.db,
    groups.map((g) => g.id),
  );
  const debts = effectiveDebts(entries, groups);
  const names = namesFor(ctx.db, entries);
  const people = pairwise(debts)
    .filter((d) => d.from === me || d.to === me)
    .map((d): PersonBalance => {
      const other = d.from === me ? d.to : d.from;
      const cents = d.to === me ? d.cents : -d.cents;
      return {
        memberId: other,
        name: names.get(other) ?? "Someone",
        cents,
        sentence: balanceSentence(names, me, other, cents),
      };
    })
    .sort(
      (a, b) =>
        Math.abs(b.cents) - Math.abs(a.cents) || a.name.localeCompare(b.name),
    );
  const overallCents = people.reduce((s, p) => s + p.cents, 0);
  return { overallCents, sentence: overallSentence(overallCents), people };
}

/** `from` owes `to`, worded for the viewer. */
export interface BalanceRow extends Debt {
  fromName: string;
  toName: string;
  sentence: string;
  /** The viewer is `from` or `to`. */
  involvesYou: boolean;
}

export interface GroupBalances {
  /** Net between each pair of members, from every expense and payment. */
  pairs: BalanceRow[];
  /** Fewest transfers that settle the whole group. */
  simplified: BalanceRow[];
  /** Each current member's overall position in the group (positive = is owed). */
  members: PersonBalance[];
  /** The group's saved setting: home and drill-downs use `simplified` for this group. */
  simplify: boolean;
  /** The biggest amount the viewer owes one person here (per the setting), to prefill "Record payment". */
  largestYouOwe: BalanceRow | null;
}

export function groupBalances(ctx: Ctx, groupId: number): GroupBalances {
  const group = requireGroup(ctx, parse(id, groupId));
  const me = ctx.user.memberId;
  const entries = ledger(ctx.db, [group.id]);
  const debts = entries.flatMap(entryDebts);
  const current = groupMembers(ctx.db, group.id);
  const names = namesFor(
    ctx.db,
    entries,
    current.map((m) => m.id),
  );
  const row = (d: Debt): BalanceRow => ({
    ...d,
    fromName: names.get(d.from) ?? "Someone",
    toName: names.get(d.to) ?? "Someone",
    sentence: debtSentence(names, me, d),
    involvesYou: d.from === me || d.to === me,
  });
  const nets = memberNets(debts);
  const members = current.map((m): PersonBalance => ({
    memberId: m.id,
    name: m.name,
    cents: nets.get(m.id) ?? 0,
    sentence: netSentence(names, me, m.id, nets.get(m.id) ?? 0),
  }));
  const pairs = pairwise(debts).map(row).sort(youFirst);
  const simplified = simplify(nets).map(row).sort(youFirst);
  const largestYouOwe =
    (group.simplify ? simplified : pairs)
      .filter((d) => d.from === me)
      .sort((a, b) => b.cents - a.cents)[0] ?? null;
  return {
    pairs,
    simplified,
    members,
    simplify: group.simplify,
    largestYouOwe,
  };
}

/** Rows involving the viewer first, then largest amount first. */
function youFirst(a: BalanceRow, b: BalanceRow): number {
  return Number(b.involvesYou) - Number(a.involvesYou) || b.cents - a.cents;
}

export interface DrillDownLine {
  /** "simplify": the adjustment a group with simplify on makes to this balance. */
  kind: LedgerEntry["kind"] | "simplify";
  /** Expense or payment id (the group id for "simplify"). */
  id: number;
  groupId: number;
  date: LocalDate;
  /** When it was recorded (ISO timestamp), to label backdated entries; null for "simplify". */
  createdAt: string | null;
  title: string;
  /** Change to what the person owes the viewer (negative: the viewer owes more). */
  effectCents: Cents;
  /** What the person owes the viewer after this line; the first (newest) line equals the headline. */
  runningCents: Cents;
  /** "Dinner: you paid $60.00, Ana's share $20.00, so Ana owes you $20.00". */
  sentence: string;
  /** "Ana owes you $22.10" after this line. */
  runningSentence: string;
}

export interface DrillDown extends PersonBalance {
  /** Newest first. */
  lines: DrillDownLine[];
}

/**
 * Every bill and payment between the viewer and `memberId`, ordered by date
 * then recording time, overall or within
 * one group. 404 unless they share a group (or the given group).
 */
export function personDrillDown(
  ctx: Ctx,
  memberId: number,
  groupId?: number,
): DrillDown {
  const me = ctx.user.memberId;
  const other = parse(id, memberId);
  const groups =
    groupId === undefined
      ? groupsForMember(ctx.db, me)
      : [requireGroup(ctx, parse(id, groupId))];
  const entries = ledger(
    ctx.db,
    groups.map((g) => g.id),
  );
  const known =
    groups.some((g) => isGroupMember(ctx.db, g.id, other)) ||
    entries.some((e) =>
      entryDebts(e).some((d) => d.from === other || d.to === other),
    );
  if (!known || other === me) throw notFound("Person");
  const names = namesFor(ctx.db, entries, [other, me]);
  const lines = drill(entries, me, other).map((l): DrillDownLine => ({
    kind: l.entry.kind,
    id: l.entry.id,
    groupId: l.entry.groupId,
    date: l.entry.date,
    createdAt: l.entry.created,
    title: l.entry.title,
    effectCents: l.effectCents,
    runningCents: l.runningCents,
    sentence: drillSentence(names, me, other, l),
    runningSentence: balanceSentence(names, me, other, l.runningCents),
  }));
  // Groups with simplify on reroute debts; one line per group explains the difference.
  let running = lines[0]?.runningCents ?? 0;
  for (const g of groups.filter((g) => g.simplify)) {
    const own = entries.filter((e) => e.groupId === g.id).flatMap(entryDebts);
    const raw = netBetween(own, me, other);
    const simplified = netBetween(simplify(memberNets(own)), me, other);
    if (raw === simplified) continue;
    running += simplified - raw;
    lines.unshift({
      kind: "simplify",
      id: g.id,
      groupId: g.id,
      date: todayLocal(),
      createdAt: null,
      title: g.name,
      effectCents: simplified - raw,
      runningCents: running,
      sentence: simplifySentence(names, me, other, g.name, raw, simplified),
      runningSentence: balanceSentence(names, me, other, running),
    });
  }
  const cents = netBetween(effectiveDebts(entries, groups), me, other);
  return {
    memberId: other,
    name: names.get(other) ?? "Someone",
    cents,
    sentence: balanceSentence(names, me, other, cents),
    lines,
  };
}
