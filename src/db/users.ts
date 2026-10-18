import type { Db } from "./connection.ts";
import { all, insertedId, one, run } from "./rows.ts";

export interface User {
  id: number;
  email: string;
  name: string;
  created: string;
  /** The member row representing this user in groups. */
  memberId: number;
  /** Venmo username without the @, if they gave one. */
  venmo: string | null;
  /** What divvy found at their public Venmo profile when it was saved. */
  venmoStatus: VenmoStatus | null;
  /** A copy of their Venmo photo is stored (served at /api/users/:id/venmo-avatar). */
  hasVenmoAvatar: boolean;
}

export type VenmoStatus = "found" | "not_found" | "unavailable";

type UserRow = Omit<User, "hasVenmoAvatar"> & { hasVenmoAvatar: number };
const toUser = (r: UserRow | undefined): User | undefined =>
  r && { ...r, hasVenmoAvatar: r.hasVenmoAvatar === 1 };

const SELECT = `SELECT u.id, u.email, u.name, u.created, m.id AS memberId, u.venmo,
  u.venmo_status AS venmoStatus, (u.venmo_avatar IS NOT NULL) AS hasVenmoAvatar
  FROM users u JOIN members m ON m.user_id = u.id`;

export function getUser(db: Db, id: number): User | undefined {
  return toUser(one<UserRow>(db, `${SELECT} WHERE u.id = ?`, id));
}

/** The user any of whose sign-in emails is `email`. */
export function findUserByEmail(db: Db, email: string): User | undefined {
  return toUser(
    one<UserRow>(
      db,
      `${SELECT} WHERE u.id = (SELECT user_id FROM user_emails WHERE email = ?)`,
      email,
    ),
  );
}

/** Insert the users row and its primary email; callers give it a member (see services/users.ts). */
export function insertUser(db: Db, email: string, name: string): number {
  const id = insertedId(
    run(db, "INSERT INTO users (email, name) VALUES (?, ?)", email, name),
  );
  run(
    db,
    "INSERT INTO user_emails (user_id, email, verified_at, is_primary) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)",
    id,
    email,
  );
  return id;
}

export interface UserEmail {
  id: number;
  userId: number;
  email: string;
  verifiedAt: string | null;
  primary: boolean;
}

/** A user's sign-in emails, primary first. */
export function listUserEmails(db: Db, userId: number): UserEmail[] {
  return all<Omit<UserEmail, "primary"> & { primary: number }>(
    db,
    `SELECT id, user_id AS userId, email, verified_at AS verifiedAt, is_primary AS "primary"
       FROM user_emails WHERE user_id = ? ORDER BY is_primary DESC, email`,
    userId,
  ).map((e) => ({ ...e, primary: e.primary === 1 }));
}

export function addUserEmail(db: Db, userId: number, email: string): void {
  run(
    db,
    "INSERT INTO user_emails (user_id, email, verified_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
    userId,
    email,
  );
}

export function removeUserEmail(db: Db, id: number): void {
  run(db, "DELETE FROM user_emails WHERE id = ?", id);
}

/** Make `emailId` the user's primary email (also users.email). Run inside a transaction. */
export function setPrimaryEmail(db: Db, userId: number, emailId: number): void {
  run(db, "UPDATE user_emails SET is_primary = 0 WHERE user_id = ?", userId);
  run(
    db,
    "UPDATE user_emails SET is_primary = 1 WHERE id = ? AND user_id = ?",
    emailId,
    userId,
  );
  run(
    db,
    "UPDATE users SET email = (SELECT email FROM user_emails WHERE id = ?) WHERE id = ?",
    emailId,
    userId,
  );
}

/**
 * Nothing but the account itself: no groups, bills, payments, tokens or
 * receipts. Such an account (made by a first sign-in) may be merged away.
 */
export function isEmptyUser(db: Db, userId: number): boolean {
  const n = (sql: string) =>
    Number((one(db, sql, userId, userId) as { n: number }).n);
  return (
    n(
      `SELECT (SELECT count(*) FROM group_members gm JOIN members m ON m.id = gm.member_id WHERE m.user_id = ?)
            + (SELECT count(*) FROM expenses WHERE created_by = ?) AS n`,
    ) === 0 &&
    n(
      `SELECT (SELECT count(*) FROM payments WHERE created_by = ?)
            + (SELECT count(*) FROM api_tokens WHERE user_id = ?) AS n`,
    ) === 0 &&
    n(
      `SELECT (SELECT count(*) FROM receipts WHERE uploaded_by = ?)
            + (SELECT count(*) FROM expense_shares es JOIN members m ON m.id = es.member_id WHERE m.user_id = ?) AS n`,
    ) === 0
  );
}

/** Delete an empty user, their member and their emails. */
export function deleteUser(db: Db, userId: number): void {
  run(db, "DELETE FROM members WHERE user_id = ?", userId);
  run(db, "DELETE FROM users WHERE id = ?", userId);
}

/** Rename a user and the member that represents them. */
export function renameUser(db: Db, id: number, name: string): void {
  run(db, "UPDATE users SET name = ? WHERE id = ?", name, id);
  run(db, "UPDATE members SET name = ? WHERE user_id = ?", name, id);
}

/** Set the username; a different one forgets what was found for the old one. */
export function setVenmo(db: Db, id: number, venmo: string | null): void {
  run(
    db,
    `UPDATE users SET venmo = ?1,
       venmo_status = CASE WHEN venmo IS ?1 THEN venmo_status END,
       venmo_avatar = CASE WHEN venmo IS ?1 THEN venmo_avatar END
     WHERE id = ?2`,
    venmo,
    id,
  );
}

export function setVenmoLookup(
  db: Db,
  id: number,
  status: VenmoStatus,
  avatar: string | null,
): void {
  run(
    db,
    "UPDATE users SET venmo_status = ?, venmo_avatar = ? WHERE id = ?",
    status,
    avatar,
    id,
  );
}

/** Relative path of the stored Venmo photo, if any. */
export function venmoAvatarPath(db: Db, id: number): string | null {
  const r = one<{ p: string | null }>(
    db,
    "SELECT venmo_avatar AS p FROM users WHERE id = ?",
    id,
  );
  return r?.p ?? null;
}

/** Venmo usernames of these members (placeholders never have one). */
export function venmoOfMembers(
  db: Db,
  memberIds: number[],
): Map<number, string> {
  if (memberIds.length === 0) return new Map();
  const rows = all<{ memberId: number; venmo: string }>(
    db,
    `SELECT m.id AS memberId, u.venmo FROM members m JOIN users u ON u.id = m.user_id
       WHERE u.venmo IS NOT NULL AND m.id IN (${memberIds.map(() => "?").join(", ")})`,
    ...memberIds,
  );
  return new Map(rows.map((r) => [r.memberId, r.venmo]));
}

/** Everyone who has signed in, by name. */
export function listUsers(db: Db): User[] {
  return all<UserRow>(db, `${SELECT} ORDER BY u.name COLLATE NOCASE, u.id`).map(
    (r) => toUser(r)!,
  );
}
