import type { Db } from "./connection.ts";
import { all, one, placeholders, run } from "./rows.ts";

/** A browser's push subscription: where to send, and its keys (base64url). */
export interface PushSubscriptionRow {
  id: number;
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NotifyPrefs {
  /** New expenses they're on. */
  expenses: boolean;
  /** Payments they made or received. */
  payments: boolean;
}

export type NotifyKind = keyof NotifyPrefs;

const SELECT =
  "SELECT id, user_id AS userId, endpoint, p256dh, auth FROM push_subscriptions";

/** Save a device's subscription for `userId`; an endpoint moves to whoever subscribed it last. */
export function upsertSubscription(
  db: Db,
  s: Omit<PushSubscriptionRow, "id">,
): void {
  run(
    db,
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    s.userId,
    s.endpoint,
    s.p256dh,
    s.auth,
  );
}

export function deleteSubscription(
  db: Db,
  endpoint: string,
  userId?: number,
): void {
  if (userId === undefined)
    run(db, "DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint);
  else
    run(
      db,
      "DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?",
      endpoint,
      userId,
    );
}

/** Every device of these users that wants `kind`. */
export function subscriptionsFor(
  db: Db,
  userIds: number[],
  kind: NotifyKind,
): PushSubscriptionRow[] {
  if (userIds.length === 0) return [];
  return all<PushSubscriptionRow>(
    db,
    `SELECT s.id, s.user_id AS userId, s.endpoint, s.p256dh, s.auth
       FROM push_subscriptions s JOIN users u ON u.id = s.user_id
      WHERE s.user_id IN (${placeholders(userIds.length)}) AND u.notify_${kind} = 1`,
    ...userIds,
  );
}

export function getPrefs(db: Db, userId: number): NotifyPrefs {
  const r = one<{ expenses: number; payments: number }>(
    db,
    "SELECT notify_expenses AS expenses, notify_payments AS payments FROM users WHERE id = ?",
    userId,
  )!;
  return { expenses: r.expenses === 1, payments: r.payments === 1 };
}

export function setPref(
  db: Db,
  userId: number,
  kind: NotifyKind,
  on: boolean,
): void {
  run(
    db,
    `UPDATE users SET notify_${kind} = ? WHERE id = ?`,
    on ? 1 : 0,
    userId,
  );
}

export interface VapidRow {
  publicKey: string;
  privateJwk: string;
}

export function getVapid(db: Db): VapidRow | undefined {
  return one<VapidRow>(
    db,
    "SELECT public_key AS publicKey, private_jwk AS privateJwk FROM vapid_keys WHERE id = 1",
  );
}

/** Keep the first key pair saved; a second one made concurrently is dropped. */
export function insertVapid(db: Db, v: VapidRow): void {
  run(
    db,
    "INSERT OR IGNORE INTO vapid_keys (id, public_key, private_jwk) VALUES (1, ?, ?)",
    v.publicKey,
    v.privateJwk,
  );
}
