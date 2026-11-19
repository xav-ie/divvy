import type { LocalDate, MemberId } from "./types.ts";

export interface ChoreRule {
  /** The first turn's first day. */
  starts: LocalDate;
  /** Days per turn; the next turn starts the day after. */
  everyDays: number;
  /** No turn starts after this day. */
  ends: LocalDate | null;
  /** Member ids in turn order. */
  rotation: MemberId[];
}

/** Turns starting from `from` up to (not including) `until` skip the member. */
export interface AwaySpan {
  memberId: MemberId;
  from: LocalDate;
  until: LocalDate;
}

export interface Turn {
  start: LocalDate;
  /** Last day, inclusive. */
  end: LocalDate;
  /** Null when everyone in the rotation is away. */
  memberId: MemberId | null;
  /** Whose turn it was before a swap handed it to `memberId`. */
  swappedFrom: MemberId | null;
}

/** `date` moved by `days`, on the calendar (no time zones involved). */
export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const t = (s: LocalDate) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

const isAway = (away: AwaySpan[], memberId: MemberId, day: LocalDate) =>
  away.some((a) => a.memberId === memberId && a.from <= day && day < a.until);

/**
 * Every turn that ends on or after `from` and starts before `until`, in order.
 * Turns go round the rotation; whoever is away when a turn starts is skipped
 * and the turn goes to the next person, so the order carries on from there.
 * A swap changes who does one turn without moving anyone else's.
 */
export function turns(
  rule: ChoreRule,
  away: AwaySpan[],
  swaps: ReadonlyMap<LocalDate, MemberId>,
  range: { from: LocalDate; until: LocalDate },
): Turn[] {
  const out: Turn[] = [];
  const n = rule.rotation.length;
  let next = 0;
  for (
    let start = rule.starts;
    start < range.until && (rule.ends === null || start <= rule.ends);
    start = addDays(start, rule.everyDays)
  ) {
    let memberId: MemberId | null = null;
    for (let k = 0; k < n; k++) {
      const candidate = rule.rotation[(next + k) % n]!;
      if (!isAway(away, candidate, start)) {
        memberId = candidate;
        next = (next + k + 1) % n;
        break;
      }
    }
    const end = addDays(start, rule.everyDays - 1);
    if (end < range.from) continue;
    const swapped = swaps.get(start);
    out.push(
      swapped !== undefined && swapped !== memberId
        ? { start, end, memberId: swapped, swappedFrom: memberId }
        : { start, end, memberId, swappedFrom: null },
    );
  }
  return out;
}
