import type { LocalDate } from "./types.ts";

/** `YYYY-MM`. */
export type Month = string;

export type RecurringStatus = "billed" | "due" | "upcoming";

/** Today on the server's local calendar. */
export function todayLocal(now = new Date()): LocalDate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const monthOf = (date: LocalDate): Month => date.slice(0, 7);

/** The month before `month`. */
export function prevMonth(month: Month): Month {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** The bill's date in `month`: its day of month (1..28 always exists). */
export const billDate = (month: Month, dayOfMonth: number): LocalDate =>
  `${month}-${String(dayOfMonth).padStart(2, "0")}`;

/** Months up to and including `lastMonth` count as billed. */
export const isBilled = (lastMonth: Month | null, month: Month): boolean =>
  lastMonth !== null && month <= lastMonth;

/** The month after `month`. */
export function nextMonth(month: Month): Month {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** It doesn't bill before its first month. */
export const notStarted = (
  startsMonth: Month | null | undefined,
  month: Month,
): boolean => startsMonth != null && month < startsMonth;

/** Where a template stands this month. */
export function recurringStatus(
  t: {
    dayOfMonth: number;
    lastMonth: Month | null;
    startsMonth?: Month | null;
    manualMonth?: Month | null;
  },
  today: LocalDate,
): RecurringStatus {
  if (notStarted(t.startsMonth, monthOf(today))) return "upcoming";
  if (isBilled(t.lastMonth, monthOf(today))) return "billed";
  // Its bill was deleted this month: offered again by hand.
  if (t.manualMonth === monthOf(today)) return "due";
  return Number(today.slice(8, 10)) >= t.dayOfMonth ? "due" : "upcoming";
}
