import type { Cents } from "./types.ts";

/** "@Xavier-R" -> "Xavier-R". */
const normalizeVenmo = (handle: string): string =>
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
