import type { LocalDate } from "../domain/types.ts";

/** Today in the local time zone as `YYYY-MM-DD`. */
export function todayLocal(now = new Date()): LocalDate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "Oct 12" this year, "Oct 12, 2025" otherwise; never through UTC. */
export function formatDate(date: LocalDate, now = new Date()): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** 1250 -> "12.50", for prefilling amount inputs. */
export const centsInput = (cents: number): string => (cents / 100).toFixed(2);

/** "Oct 12, 3:04 PM" for an ISO timestamp, in local time. */
export const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
