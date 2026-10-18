import type { Db } from "./connection.ts";
import { all, insertedId, one, placeholders, run } from "./rows.ts";

export interface Member {
  id: number;
  userId: number | null;
  name: string;
  inviteEmail: string | null;
  placeholder: boolean;
}

export interface MemberRow extends Omit<Member, "placeholder"> {
  placeholder: number;
}

const SELECT =
  "SELECT id, user_id AS userId, name, invite_email AS inviteEmail, placeholder FROM members";
export const toMember = (r: MemberRow): Member => ({
  ...r,
  placeholder: r.placeholder === 1,
});

export function getMember(db: Db, id: number): Member | undefined {
  const r = one<MemberRow>(db, `${SELECT} WHERE id = ?`, id);
  return r && toMember(r);
}

export function getMembers(db: Db, ids: number[]): Member[] {
  if (ids.length === 0) return [];
  return all<MemberRow>(
    db,
    `${SELECT} WHERE id IN (${placeholders(ids.length)})`,
    ...ids,
  ).map(toMember);
}

export function memberForUser(db: Db, userId: number): Member | undefined {
  const r = one<MemberRow>(db, `${SELECT} WHERE user_id = ?`, userId);
  return r && toMember(r);
}

/** Placeholders invited with this email, oldest first. */
export function placeholdersByEmail(db: Db, email: string): Member[] {
  return all<MemberRow>(
    db,
    `${SELECT} WHERE placeholder = 1 AND invite_email = ? ORDER BY id`,
    email,
  ).map(toMember);
}

export function insertMember(
  db: Db,
  m: {
    userId?: number | null;
    name: string;
    inviteEmail?: string | null;
    placeholder: boolean;
  },
): number {
  return insertedId(
    run(
      db,
      "INSERT INTO members (user_id, name, invite_email, placeholder) VALUES (?, ?, ?, ?)",
      m.userId ?? null,
      m.name,
      m.inviteEmail ?? null,
      m.placeholder ? 1 : 0,
    ),
  );
}

export function renameMember(db: Db, memberId: number, name: string): void {
  run(db, "UPDATE members SET name = ? WHERE id = ?", name, memberId);
}

export function setInviteEmail(db: Db, memberId: number, email: string): void {
  run(db, "UPDATE members SET invite_email = ? WHERE id = ?", email, memberId);
}

/** Turn a placeholder into the given user's member. */
export function claimPlaceholder(
  db: Db,
  memberId: number,
  userId: number,
  name: string,
): void {
  run(
    db,
    "UPDATE members SET user_id = ?, name = ?, placeholder = 0 WHERE id = ?",
    userId,
    name,
    memberId,
  );
}

function moveSplitKeys(json: string, from: number, into: number): string {
  const split = JSON.parse(json) as Record<string, number>;
  const v = split[from];
  if (v === undefined) return json;
  delete split[from];
  split[into] = (split[into] ?? 0) + v;
  return JSON.stringify(split);
}

/**
 * Move everything that references member `from` onto member `into` (group
 * memberships, payers, shares, item splits, payments, recurring templates),
 * then delete `from`. Run inside a transaction.
 */
export function mergeMember(db: Db, from: number, into: number): void {
  run(
    db,
    "INSERT OR IGNORE INTO group_members (group_id, member_id) SELECT group_id, ? FROM group_members WHERE member_id = ?",
    into,
    from,
  );
  run(db, "DELETE FROM group_members WHERE member_id = ?", from);
  for (const table of ["expense_payers", "expense_shares"]) {
    run(
      db,
      `INSERT INTO ${table} (expense_id, member_id, cents) SELECT expense_id, ?, cents FROM ${table} WHERE member_id = ?
       ON CONFLICT (expense_id, member_id) DO UPDATE SET cents = cents + excluded.cents`,
      into,
      from,
    );
    run(db, `DELETE FROM ${table} WHERE member_id = ?`, from);
  }
  for (const table of ["expense_items", "recurring"]) {
    const rows = all<{ id: number; split: string }>(
      db,
      `SELECT id, split FROM ${table} WHERE split LIKE ?`,
      `%"${from}"%`,
    );
    for (const r of rows)
      run(
        db,
        `UPDATE ${table} SET split = ? WHERE id = ?`,
        moveSplitKeys(r.split, from, into),
        r.id,
      );
  }
  run(
    db,
    "UPDATE recurring SET payer_member = ? WHERE payer_member = ?",
    into,
    from,
  );
  run(
    db,
    "UPDATE payments SET from_member = ? WHERE from_member = ?",
    into,
    from,
  );
  run(db, "UPDATE payments SET to_member = ? WHERE to_member = ?", into, from);
  run(db, "DELETE FROM payments WHERE from_member = to_member");
  run(db, "DELETE FROM members WHERE id = ?", from);
}
