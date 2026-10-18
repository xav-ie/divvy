/** Integer cents. Never a float, never dollars. */
export type Cents = number;

/** A member (user or placeholder) id. Members are global; groups list them. */
export type MemberId = number;

/** Local calendar date, `YYYY-MM-DD`. Never converted through UTC. */
export type LocalDate = string;

/** member id -> cents (paid, share, or owed amounts). */
export type Amounts = Record<MemberId, Cents>;

export const SPLIT_TYPES = ["equal", "percent", "exact", "shares"] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

/**
 * How one item divides among members. Keys are member ids; values mean:
 * equal: any positive number includes the member; percent: percent (sum 100);
 * exact: cents (sum = line total); shares: relative weight.
 */
export type SplitMap = Record<MemberId, number>;

export interface ExpenseItem {
  name: string;
  /** Positive; fractional allowed (1.5 lb). */
  quantity: number;
  unitCents: Cents;
  splitType: SplitType;
  split: SplitMap;
}

/** `from` owes `to` this many cents. */
export interface Debt {
  from: MemberId;
  to: MemberId;
  cents: Cents;
}

/** How tax, tip or discount was entered: cents, or a percent of the item subtotal. */
export const AMOUNT_MODES = ["amount", "percent"] as const;
export type AmountMode = (typeof AMOUNT_MODES)[number];

export interface Adjustments {
  taxMode: AmountMode;
  /** Cents for "amount", percent for "percent". */
  taxValue: number;
  tipMode: AmountMode;
  tipValue: number;
  discountMode: AmountMode;
  discountValue: number;
}
