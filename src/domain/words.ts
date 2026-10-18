import type { DrillLine } from "./balances.ts";
import { formatCents } from "./money.ts";
import type { Cents, Debt, MemberId } from "./types.ts";

/** Member id -> display name. */
export type Names = ReadonlyMap<MemberId, string> | Record<MemberId, string>;

function nameOf(names: Names, id: MemberId): string {
  const n =
    names instanceof Map
      ? names.get(id)
      : (names as Record<MemberId, string>)[id];
  return n ?? "Someone";
}

/** "You", "you" or the member's name, from the viewer's point of view. */
function who(
  names: Names,
  viewer: MemberId,
  id: MemberId,
  start = false,
): string {
  if (id !== viewer) return nameOf(names, id);
  return start ? "You" : "you";
}

/** "Ana owes you $42.10" / "You owe Ben $8.00" / "Ana owes Ben $5.00". */
export function debtSentence(
  names: Names,
  viewer: MemberId,
  debt: Debt,
): string {
  if (debt.cents === 0)
    return settledSentence(names, viewer, debt.from, debt.to);
  const d =
    debt.cents > 0
      ? debt
      : { from: debt.to, to: debt.from, cents: -debt.cents };
  const verb = d.from === viewer ? "owe" : "owes";
  return `${who(names, viewer, d.from, true)} ${verb} ${who(names, viewer, d.to)} ${formatCents(d.cents)}`;
}

/** "You and Cy are settled up". */
export function settledSentence(
  names: Names,
  viewer: MemberId,
  a: MemberId,
  b: MemberId,
): string {
  const [x, y] = b === viewer ? [b, a] : [a, b];
  return `${who(names, viewer, x, true)} and ${who(names, viewer, y)} are settled up`;
}

/** Sentence for "other owes me `cents`" (negative: I owe them). */
export function balanceSentence(
  names: Names,
  viewer: MemberId,
  other: MemberId,
  cents: Cents,
): string {
  return debtSentence(names, viewer, { from: other, to: viewer, cents });
}

/** "Overall, you're owed $120.40" / "Overall, you owe $8.00" / "You're all settled up". */
export function overallSentence(cents: Cents): string {
  if (cents > 0) return `Overall, you're owed ${formatCents(cents)}`;
  if (cents < 0) return `Overall, you owe ${formatCents(cents)}`;
  return "You're all settled up";
}

/**
 * One drill-down line in words, e.g. "Dinner: you paid $60.00, Ana's share
 * $20.00, so Ana owes you $20.00" or "Ana paid you $20.00".
 */
export function drillSentence(
  names: Names,
  viewer: MemberId,
  other: MemberId,
  line: DrillLine,
): string {
  const e = line.entry;
  const effect = balanceSentence(names, viewer, other, line.effectCents);
  if (e.kind === "payment") {
    return `${e.title ? `${e.title}: ` : ""}${who(names, viewer, e.from, !e.title)} paid ${who(names, viewer, e.to)} ${formatCents(e.cents)}`;
  }
  const possessive = (id: MemberId) =>
    id === viewer ? "your" : `${nameOf(names, id)}'s`;
  const parts: string[] = [];
  for (const id of [viewer, other]) {
    if (e.paid[id])
      parts.push(`${who(names, viewer, id)} paid ${formatCents(e.paid[id])}`);
  }
  for (const id of [viewer, other]) {
    if (e.shares[id])
      parts.push(`${possessive(id)} share ${formatCents(e.shares[id])}`);
  }
  return `${e.title}: ${parts.join(", ")}, so ${effect.replace(/^You /, "you ")}`;
}

/** A member's overall position in a group: "Ana is owed $12.00 in total", "You owe $3.00 in total". */
export function netSentence(
  names: Names,
  viewer: MemberId,
  id: MemberId,
  cents: Cents,
): string {
  const you = id === viewer;
  const name = who(names, viewer, id, true);
  if (cents > 0)
    return `${name} ${you ? "are" : "is"} owed ${formatCents(cents)} in total`;
  if (cents < 0)
    return `${name} ${you ? "owe" : "owes"} ${formatCents(cents)} in total`;
  return `${name} ${you ? "are" : "is"} settled up`;
}

/**
 * Why a group with simplify on changes the balance between the viewer and
 * `other` (cents: what they owe the viewer, before and after simplifying),
 * e.g. "Simplified in House: you pay Xavier $524.00 directly instead of
 * through other members".
 */
export function simplifySentence(
  names: Names,
  viewer: MemberId,
  other: MemberId,
  group: string,
  raw: Cents,
  simplified: Cents,
): string {
  const name = nameOf(names, other);
  const pay = (c: Cents) =>
    c > 0
      ? `${name} pays you ${formatCents(c)}`
      : `you pay ${name} ${formatCents(c)}`;
  const paying = (c: Cents) =>
    c > 0
      ? `${name} paying you ${formatCents(c)}`
      : `you paying ${name} ${formatCents(c)}`;
  let how: string;
  if (simplified === 0)
    how = `you and ${name} don't pay each other; ${raw > 0 ? `${name}'s ${formatCents(raw)} to you` : `your ${formatCents(raw)} to ${name}`} goes through other members`;
  else if (raw === 0)
    how = `${pay(simplified)} directly instead of through other members`;
  else if (Math.sign(raw) === Math.sign(simplified))
    how = `${pay(simplified)} instead of ${formatCents(raw)}, settling other debts along the way`;
  else how = `${pay(simplified)} instead of ${paying(raw)}`;
  return `Simplified in ${group}: ${how}`;
}
