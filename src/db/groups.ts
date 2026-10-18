import type { Db } from "./connection.ts";
import { toMember, type Member, type MemberRow } from "./members.ts";
import { all, insertedId, one, run } from "./rows.ts";

export interface Group {
  id: number;
  name: string;
  emoji: string;
  /** User id of the creator. */
  createdBy: number;
  created: string;
  /** Balances show the fewest transfers that settle everyone. */
  simplify: boolean;
}

const SELECT =
  "SELECT g.id, g.name, g.emoji, g.created_by AS createdBy, g.created, g.simplify FROM groups g";

type GroupRow = Omit<Group, "simplify"> & { simplify: number };
const toGroup = (r: GroupRow): Group => ({ ...r, simplify: r.simplify === 1 });

export function insertGroup(
  db: Db,
  g: { name: string; emoji: string; createdBy: number },
): number {
  return insertedId(
    run(
      db,
      "INSERT INTO groups (name, emoji, created_by) VALUES (?, ?, ?)",
      g.name,
      g.emoji,
      g.createdBy,
    ),
  );
}

export function getGroup(db: Db, id: number): Group | undefined {
  const r = one<GroupRow>(db, `${SELECT} WHERE g.id = ?`, id);
  return r && toGroup(r);
}

/** Groups the member belongs to, by name. */
export function groupsForMember(db: Db, memberId: number): Group[] {
  return all<GroupRow>(
    db,
    `${SELECT} JOIN group_members gm ON gm.group_id = g.id WHERE gm.member_id = ? ORDER BY g.name COLLATE NOCASE, g.id`,
    memberId,
  ).map(toGroup);
}

export function updateGroup(
  db: Db,
  id: number,
  g: { name: string; emoji: string; simplify: boolean },
): void {
  run(
    db,
    "UPDATE groups SET name = ?, emoji = ?, simplify = ? WHERE id = ?",
    g.name,
    g.emoji,
    g.simplify ? 1 : 0,
    id,
  );
}

export function deleteGroup(db: Db, id: number): void {
  run(db, "DELETE FROM groups WHERE id = ?", id);
}

/** Current members of a group, by name. */
export function groupMembers(db: Db, groupId: number): Member[] {
  return all<MemberRow>(
    db,
    `SELECT m.id, m.user_id AS userId, m.name, m.invite_email AS inviteEmail, m.placeholder
       FROM members m JOIN group_members gm ON gm.member_id = m.id
       WHERE gm.group_id = ? ORDER BY m.name COLLATE NOCASE, m.id`,
    groupId,
  ).map(toMember);
}

export function isGroupMember(
  db: Db,
  groupId: number,
  memberId: number,
): boolean {
  return (
    one(
      db,
      "SELECT 1 FROM group_members WHERE group_id = ? AND member_id = ?",
      groupId,
      memberId,
    ) !== undefined
  );
}

export function addGroupMember(
  db: Db,
  groupId: number,
  memberId: number,
): void {
  run(
    db,
    "INSERT OR IGNORE INTO group_members (group_id, member_id) VALUES (?, ?)",
    groupId,
    memberId,
  );
}

export function removeGroupMember(
  db: Db,
  groupId: number,
  memberId: number,
): void {
  run(
    db,
    "DELETE FROM group_members WHERE group_id = ? AND member_id = ?",
    groupId,
    memberId,
  );
}

/** The two members are in at least one group together. */
export function sharesGroup(db: Db, a: number, b: number): boolean {
  return (
    one(
      db,
      `SELECT 1 FROM group_members x JOIN group_members y ON x.group_id = y.group_id
         WHERE x.member_id = ? AND y.member_id = ? LIMIT 1`,
      a,
      b,
    ) !== undefined
  );
}
