import type { Cents, MemberId } from "./types.ts";

/** "$1,234.50" for 123450; always the absolute value, callers supply direction in words. */
export function formatCents(cents: Cents): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Parse "12.5", "$1,234.56" into cents; null when it isn't a valid amount. */
export function parseCents(text: string): Cents | null {
  const m = /^\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d*)(?:\.(\d{0,2}))?\s*$/.exec(text);
  if (!m || (!m[1] && !m[2])) return null;
  return (
    Number((m[1] ?? "").replaceAll(",", "") || 0) * 100 +
    Number((m[2] ?? "").padEnd(2, "0") || 0)
  );
}

/** Round a fractional cent amount to the nearest cent (half away from zero). */
export function roundCents(x: number): Cents {
  return Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
}

export function sumCents(values: Iterable<Cents>): Cents {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

/** FNV-1a, 32 bit: a cheap, stable hash for tie-breaking. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The tie-break seed for one expense: stable while its date and title stay the same. */
export const splitSeed = (date: string, title: string): string =>
  `${date}|${title}`;

/**
 * Split `total` cents across `weights` proportionally so the parts sum to
 * `total` exactly; leftover cents go to the largest remainders. Ties go by a
 * hash of `seed` and the member id, so across bills the odd cent lands on a
 * different person while one bill always splits the same way; without a seed,
 * to the earlier entry. `favor`, if sharing, gets the first leftover cent. Negative totals allocate the absolute value and
 * negate. Ids with zero total weight get 0.
 */
export function allocate(
  total: Cents,
  weights: ReadonlyArray<readonly [MemberId, number]>,
  seed?: string,
  favor?: MemberId,
): Map<MemberId, Cents> {
  const out = new Map<MemberId, Cents>(weights.map(([id]) => [id, 0]));
  const sum = weights.reduce((s, [, w]) => s + w, 0);
  if (sum <= 0 || total === 0) return out;
  const sign = Math.sign(total);
  const abs = Math.abs(total);
  let left = abs;
  const remainders: Array<[MemberId, number]> = [];
  for (const [id, w] of weights) {
    const exact = (w / sum) * abs;
    const floor = Math.floor(exact + 1e-9);
    out.set(id, floor);
    left -= floor;
    remainders.push([id, exact - floor]);
  }
  const tie = (id: MemberId) =>
    seed === undefined ? 0 : fnv1a(`${seed}:${id}`);
  remainders.sort((a, b) =>
    b[1] - a[1] > 1e-9 ? 1 : a[1] - b[1] > 1e-9 ? -1 : tie(a[0]) - tie(b[0]),
  );
  // The favored member (with a share) takes the first leftover cent.
  const favored = weights.some(([id, w]) => id === favor && w > 0);
  const order = favored
    ? [
        ...remainders.filter(([id]) => id === favor),
        ...remainders.filter(([id]) => id !== favor),
      ]
    : remainders;
  for (const [id] of order.slice(0, left)) out.set(id, (out.get(id) ?? 0) + 1);
  if (sign < 0) for (const [id, v] of out) out.set(id, -v);
  return out;
}
