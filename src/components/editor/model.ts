import { centsInput } from "../../client/format.ts";
import {
  allocate,
  formatCents,
  parseCents,
  roundCents,
  splitSeed,
} from "../../domain/money.ts";
import {
  computeSplit,
  lineCents,
  payerErrors,
  type SplitResult,
} from "../../domain/split.ts";
import type {
  Adjustments,
  Amounts,
  ExpenseItem,
  MemberId,
  SplitMap,
  SplitType,
} from "../../domain/types.ts";

/** Editor state for the expense form; amounts stay as typed text until saved. */

export interface ItemState {
  key: number;
  name: string;
  qty: string;
  price: string;
  splitType: SplitType;
  /** Members included, in group order. */
  who: MemberId[];
  /** Percent, dollars or share weight per member for non-equal splits. */
  values: Record<MemberId, string>;
}

export interface Extra {
  value: string;
  unit: "$" | "%";
}

export interface EditorState {
  title: string;
  date: string;
  /** Off: one amount split once; on: line items with tax, tip and discount. */
  itemize: boolean;
  amount: string;
  /** How the single amount splits while itemize is off. */
  single: ItemState;
  /** Line items; kept while itemize is off so toggling never loses them. */
  items: ItemState[];
  tax: Extra;
  tip: Extra;
  discount: Extra;
  /** One payer of the full total, or several with amounts. */
  several: boolean;
  payer: MemberId;
  paid: Record<MemberId, string>;
  notes: string;
  category: string | null;
  receiptId: number | null;
  /** Who added the expense: they take leftover rounding cents (as the server does). */
  creator: MemberId;
}

/** The subset of a saved expense the editor reads back. */
export interface SavedExpense extends Adjustments {
  title: string;
  date: string;
  items: ExpenseItem[];
  taxCents: number;
  tipCents: number;
  discountCents: number;
  payers: Amounts;
  notes: string;
  category: string | null;
  /** The member who added it (takes leftover cents); defaults to the editor. */
  creatorMemberId?: MemberId | null;
}

let nextKey = 1;

export function newItem(
  who: MemberId[],
  init: Partial<ItemState> = {},
): ItemState {
  return {
    key: nextKey++,
    name: "",
    qty: "1",
    price: "",
    splitType: "equal",
    who,
    values: {},
    ...init,
  };
}

const noExtra = (): Extra => ({ value: "", unit: "$" });

export function emptyState(
  everyone: MemberId[],
  me: MemberId,
  date: string,
): EditorState {
  return {
    title: "",
    date,
    itemize: false,
    amount: "",
    single: newItem(everyone),
    items: [newItem(everyone)],
    tax: noExtra(),
    tip: noExtra(),
    discount: noExtra(),
    several: false,
    payer: me,
    paid: {},
    notes: "",
    category: null,
    receiptId: null,
    creator: me,
  };
}

const keysOf = (a: Record<MemberId, number>): MemberId[] =>
  Object.keys(a).map(Number);

/** Load a saved expense back into editor state. */
export function fromExpense(e: SavedExpense, me: MemberId): EditorState {
  const only = e.items[0];
  const itemize =
    e.items.length !== 1 ||
    e.taxCents > 0 ||
    e.tipCents > 0 ||
    e.discountCents > 0 ||
    only?.quantity !== 1 ||
    only.name !== e.title;
  const payers = keysOf(e.payers);
  // Show tax, tip and discount the way they were entered.
  const extra = (mode: Adjustments["taxMode"], value: number): Extra =>
    mode === "percent"
      ? { value: value ? String(value) : "", unit: "%" }
      : { value: value ? centsInput(value) : "", unit: "$" };
  const items = e.items.map((it) =>
    newItem(
      keysOf(it.split).filter((id) => (it.split[id] ?? 0) > 0),
      {
        name: it.name,
        qty: String(it.quantity),
        price: centsInput(it.unitCents),
        splitType: it.splitType,
        values: Object.fromEntries(
          keysOf(it.split).map((id) => [
            id,
            it.splitType === "exact"
              ? centsInput(it.split[id]!)
              : String(it.split[id]),
          ]),
        ),
      },
    ),
  );
  return {
    title: e.title,
    date: e.date,
    itemize,
    amount: only ? centsInput(lineCents(only)) : "",
    single: itemize ? newItem(items[0]?.who ?? []) : items[0]!,
    items: itemize ? items : [newItem(items[0]?.who ?? [])],
    tax: extra(e.taxMode, e.taxValue),
    tip: extra(e.tipMode, e.tipValue),
    discount: extra(e.discountMode, e.discountValue),
    several: payers.length > 1,
    payer: payers.length === 1 ? payers[0]! : me,
    paid: Object.fromEntries(
      payers.map((id) => [id, centsInput(e.payers[id]!)]),
    ),
    notes: e.notes,
    category: e.category,
    receiptId: null,
    creator: e.creatorMemberId ?? me,
  };
}

/**
 * Turn itemize on or off. Both the single split and the items stay in state.
 * Off carries the items' total into Amount; the first time items are used
 * they start from the amount and split, with an empty name to type.
 */
export function setItemize(s: EditorState, on: boolean): EditorState {
  if (!on) {
    const total = compute(s).split.totalCents;
    return {
      ...s,
      itemize: false,
      amount: total > 0 ? centsInput(total) : s.amount,
    };
  }
  const blank =
    s.items.length === 1 &&
    !s.items[0]!.name.trim() &&
    !s.items[0]!.price.trim();
  return {
    ...s,
    itemize: true,
    items: blank
      ? [
          {
            ...s.single,
            key: s.items[0]!.key,
            name: "",
            qty: "1",
            price: s.amount,
          },
        ]
      : s.items,
  };
}

/** Cents for a typed amount; NaN when it isn't one (domain validation then reports it). */
const cents = (text: string): number => parseCents(text) ?? NaN;

function quantity(text: string): number {
  const n = Number(text.trim());
  return text.trim() && Number.isFinite(n) ? n : NaN;
}

/** The item as the domain sees it: price and quantity from the item (or the single amount). */
function toItem(s: EditorState, item: ItemState): ExpenseItem {
  const split: SplitMap = {};
  for (const id of item.who) {
    const raw = item.values[id] ?? "";
    split[id] =
      item.splitType === "equal"
        ? 1
        : item.splitType === "exact"
          ? cents(raw)
          : raw.trim() === ""
            ? 0
            : Number(raw);
  }
  return s.itemize
    ? {
        name: item.name.trim(),
        quantity: quantity(item.qty),
        unitCents: cents(item.price),
        splitType: item.splitType,
        split,
      }
    : {
        name: s.title.trim(),
        quantity: 1,
        unitCents: cents(s.amount),
        splitType: item.splitType,
        split,
      };
}

/** Tax, tip or discount in cents; percentages apply to the subtotal. */
function extraCents(extra: Extra, subtotal: number): number {
  if (!extra.value.trim()) return 0;
  if (extra.unit === "$") return cents(extra.value);
  const pct = Number(extra.value.replace("%", "").trim());
  return Number.isFinite(pct) ? roundCents((subtotal * pct) / 100) : NaN;
}

export interface Computed {
  items: ExpenseItem[];
  taxCents: number;
  tipCents: number;
  discountCents: number;
  split: SplitResult;
  payers: Amounts;
  /** Split problems, then payer problems. */
  errors: string[];
  /** Total minus what the several payers entered (0 for a single payer). */
  remainingCents: number;
}

export function compute(s: EditorState): Computed {
  const items = (s.itemize ? s.items : [s.single]).map((it) => toItem(s, it));
  const subtotal = items.reduce(
    (sum, it) =>
      sum +
      (Number.isFinite(it.unitCents) && Number.isFinite(it.quantity)
        ? lineCents(it)
        : 0),
    0,
  );
  const extra = (e: Extra) => (s.itemize ? extraCents(e, subtotal) : 0);
  const taxCents = extra(s.tax);
  const tipCents = extra(s.tip);
  const discountCents = extra(s.discount);
  // Same seed, creator and payers as the server, so the odd cent lands where
  // saving will put it. (A single payer's amount is the total; only who matters here.)
  const split = computeSplit({
    items,
    taxCents,
    tipCents,
    discountCents,
    seed: splitSeed(s.date, s.title.trim()),
    creator: s.creator,
    payers: payerHint(s),
  });
  const payers: Amounts = s.several
    ? Object.fromEntries(
        Object.entries(s.paid)
          .filter(([, v]) => v.trim())
          .map(([id, v]) => [Number(id), cents(v)]),
      )
    : { [s.payer]: Math.max(split.totalCents, 0) };
  const paid = Object.values(payers).reduce(
    (a, b) => a + (Number.isFinite(b) ? b : 0),
    0,
  );
  const errors = split.errors.length
    ? split.errors
    : payerErrors(payers, split.totalCents);
  return {
    items,
    taxCents,
    tipCents,
    discountCents,
    split,
    payers,
    errors,
    remainingCents: s.several ? split.totalCents - paid : 0,
  };
}

/** `{taxMode, taxValue}` etc.: percents are stored as typed so later item edits recompute them. */
function modeOf(
  name: "tax" | "tip" | "discount",
  e: Extra | null,
  cents: number,
) {
  const pct = e?.unit === "%" && e.value.trim() !== "";
  return {
    [`${name}Mode`]: pct ? "percent" : "amount",
    [`${name}Value`]: pct ? Number(e.value.replace("%", "").trim()) : cents,
  };
}

/** Request body for create/update. */
export function toInput(s: EditorState, c: Computed) {
  return {
    title: s.title.trim(),
    date: s.date,
    items: c.items,
    taxCents: c.taxCents,
    tipCents: c.tipCents,
    discountCents: c.discountCents,
    ...modeOf("tax", s.itemize ? s.tax : null, c.taxCents),
    ...modeOf("tip", s.itemize ? s.tip : null, c.tipCents),
    ...modeOf("discount", s.itemize ? s.discount : null, c.discountCents),
    payers: c.payers,
    notes: s.notes,
    category: s.category,
    ...(s.receiptId ? { receiptId: s.receiptId } : {}),
  };
}

/**
 * Starting values when an item switches split type: equal parts of 100% or
 * of the item's amount, or one share each, so the split is valid right away.
 */
export function resplit(
  item: ItemState,
  type: SplitType,
  lineTotal: number,
): ItemState {
  const n = item.who.length;
  let values: Record<MemberId, string> = {};
  if (type === "shares")
    values = Object.fromEntries(item.who.map((id) => [id, "1"]));
  if (type === "percent" && n) {
    const parts = allocate(
      10000,
      item.who.map((id) => [id, 1]),
    );
    values = Object.fromEntries(
      [...parts].map(([id, v]) => [id, String(v / 100)]),
    );
  }
  if (type === "exact" && n && Number.isFinite(lineTotal)) {
    const parts = allocate(
      lineTotal,
      item.who.map((id) => [id, 1]),
    );
    values = Object.fromEntries(
      [...parts].map(([id, v]) => [id, centsInput(v)]),
    );
  }
  return { ...item, splitType: type, values };
}

/** The item's line total in cents for the current state (NaN while invalid). */
export function itemLine(s: EditorState, item: ItemState): number {
  const it = toItem(s, item);
  return Number.isFinite(it.unitCents) && Number.isFinite(it.quantity)
    ? lineCents(it)
    : NaN;
}

/** "10% left", "5% over", "$3.00 left" while a percent or exact split doesn't add up; null when it does. */
export function splitGap(s: EditorState, item: ItemState): string | null {
  if (item.splitType !== "percent" && item.splitType !== "exact") return null;
  const values = item.who.map((id) => item.values[id] ?? "");
  if (item.splitType === "percent") {
    const left = 100 - values.reduce((a, v) => a + (Number(v) || 0), 0);
    if (Math.abs(left) < 0.001) return null;
    return `${+Math.abs(left).toFixed(3)}% ${left > 0 ? "left" : "over"}`;
  }
  const line = itemLine(s, item);
  if (!Number.isFinite(line)) return null;
  const left = line - values.reduce((a, v) => a + (parseCents(v) ?? 0), 0);
  if (left === 0) return null;
  return `${formatCents(left)} ${left > 0 ? "left" : "over"}`;
}

/** Who paid how much, for picking who takes a rounding cent (a single payer's amount doesn't matter). */
function payerHint(s: EditorState): Amounts {
  return s.several
    ? Object.fromEntries(
        Object.entries(s.paid).map(([id, v]) => [
          Number(id),
          parseCents(v) ?? 0,
        ]),
      )
    : { [s.payer]: 1 };
}

/** Each person's cents of this one item (before tax and tip), or null while it doesn't split cleanly. */
export function itemShares(s: EditorState, item: ItemState): Amounts | null {
  const r = computeSplit({
    items: [toItem(s, item)],
    taxCents: 0,
    tipCents: 0,
    discountCents: 0,
    seed: splitSeed(s.date, s.title.trim()),
    creator: s.creator,
    payers: payerHint(s),
  });
  return r.errors.length ? null : r.shares;
}
