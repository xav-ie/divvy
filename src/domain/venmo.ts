import type { Cents } from "./types.ts";

/** Venmo's handle rules: 5-30 letters, digits, hyphens or underscores. */
export const VENMO_HANDLE = /^[A-Za-z0-9_-]{5,30}$/;

/** "@Xavier-R" -> "Xavier-R". */
export const normalizeVenmo = (handle: string): string =>
  handle.trim().replace(/^@/, "");

/**
 * A link that opens Venmo (the app on phones) ready to pay `username`
 * exactly `cents`, with a note. Pay only: charge requests are never made.
 */
export function venmoPayUrl(
  username: string,
  cents: Cents,
  note: string,
): string {
  const amount = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  return `https://venmo.com/${encodeURIComponent(normalizeVenmo(username))}?txn=pay&amount=${amount}&note=${encodeURIComponent(note)}`;
}
