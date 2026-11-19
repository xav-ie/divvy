import type { AwaySpan } from "../domain/chores.ts";
import type { LocalDate, MemberId } from "../domain/types.ts";
import type { Db } from "./connection.ts";
import { all, insertedId, one, run } from "./rows.ts";

export interface Chore {
  id: number;
  groupId: number;
  name: string;
  /** One step per line. */
  instructions: string;
  everyDays: number;
  starts: LocalDate;
  ends: LocalDate | null;
  /** Member ids in turn order. */
  rotation: MemberId[];
  /** User id of the creator. */
  createdBy: number;
}

export type ChoreWrite = Omit<Chore, "id" | "createdBy">;

export interface Away extends AwaySpan {
  id: number;
  groupId: number;
  /** User id of whoever added it. */
  createdBy: number;
}

type Row = Omit<Chore, "rotation"> & { rotation: string };

const SELECT = `SELECT id, group_id AS groupId, name, instructions, every_days AS everyDays, starts, ends, rotation,
  created_by AS createdBy FROM chores`;

const toChore = (r: Row): Chore => ({
  ...r,
  rotation: JSON.parse(r.rotation) as MemberId[],
});

export function insertChore(db: Db, c: ChoreWrite, createdBy: number): number {
  return insertedId(
    run(
      db,
      `INSERT INTO chores (group_id, name, instructions, every_days, starts, ends, rotation, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      c.groupId,
      c.name,
      c.instructions,
      c.everyDays,
      c.starts,
      c.ends,
      JSON.stringify(c.rotation),
      createdBy,
    ),
  );
}

export function updateChore(db: Db, id: number, c: ChoreWrite): void {
  run(
    db,
    `UPDATE chores SET name = ?, instructions = ?, every_days = ?, starts = ?, ends = ?, rotation = ? WHERE id = ?`,
    c.name,
    c.instructions,
    c.everyDays,
    c.starts,
    c.ends,
    JSON.stringify(c.rotation),
    id,
  );
}

export function deleteChore(db: Db, id: number): void {
  run(db, "DELETE FROM chores WHERE id = ?", id);
}

export function getChore(db: Db, id: number): Chore | undefined {
  const r = one<Row>(db, `${SELECT} WHERE id = ?`, id);
  return r && toChore(r);
}

/** A group's chores, by name. */
export function listChores(db: Db, groupId: number): Chore[] {
  return all<Row>(
    db,
    `${SELECT} WHERE group_id = ? ORDER BY name COLLATE NOCASE, id`,
    groupId,
  ).map(toChore);
}

/** Turn start -> who does it instead. */
export function choreSwaps(db: Db, choreId: number): Map<LocalDate, MemberId> {
  return new Map(
    all<{ turnStart: string; memberId: number }>(
      db,
      "SELECT turn_start AS turnStart, member_id AS memberId FROM chore_swaps WHERE chore_id = ?",
      choreId,
    ).map((r) => [r.turnStart, r.memberId]),
  );
}

/** Hand the turn starting `turnStart` to `memberId`; null puts it back. */
export function setSwap(
  db: Db,
  choreId: number,
  turnStart: LocalDate,
  memberId: MemberId | null,
): void {
  if (memberId === null)
    run(
      db,
      "DELETE FROM chore_swaps WHERE chore_id = ? AND turn_start = ?",
      choreId,
      turnStart,
    );
  else
    run(
      db,
      `INSERT INTO chore_swaps (chore_id, turn_start, member_id) VALUES (?, ?, ?)
       ON CONFLICT (chore_id, turn_start) DO UPDATE SET member_id = excluded.member_id`,
      choreId,
      turnStart,
      memberId,
    );
}

export function clearSwaps(db: Db, choreId: number): void {
  run(db, "DELETE FROM chore_swaps WHERE chore_id = ?", choreId);
}

const AWAY = `SELECT id, group_id AS groupId, member_id AS memberId, from_date AS "from", until_date AS until,
  created_by AS createdBy FROM chore_away`;

export function insertAway(
  db: Db,
  a: Omit<Away, "id" | "createdBy">,
  createdBy: number,
): number {
  return insertedId(
    run(
      db,
      "INSERT INTO chore_away (group_id, member_id, from_date, until_date, created_by) VALUES (?, ?, ?, ?, ?)",
      a.groupId,
      a.memberId,
      a.from,
      a.until,
      createdBy,
    ),
  );
}

export function getAway(db: Db, id: number): Away | undefined {
  return one<Away>(db, `${AWAY} WHERE id = ?`, id);
}

/** A group's time away, soonest first. */
export function listAway(db: Db, groupId: number): Away[] {
  return all<Away>(
    db,
    `${AWAY} WHERE group_id = ? ORDER BY from_date, id`,
    groupId,
  );
}

export function deleteAway(db: Db, id: number): void {
  run(db, "DELETE FROM chore_away WHERE id = ?", id);
}

/** Claim the "your turn" push for a turn; false when it already went out. */
export function claimReminder(
  db: Db,
  choreId: number,
  turnStart: LocalDate,
): boolean {
  return (
    run(
      db,
      "INSERT OR IGNORE INTO chore_reminders (chore_id, turn_start) VALUES (?, ?)",
      choreId,
      turnStart,
    ).changes === 1
  );
}

/** Every chore in groups that have chores on. */
export function activeChores(db: Db): Chore[] {
  return all<Row>(
    db,
    `${SELECT} WHERE group_id IN (SELECT id FROM groups WHERE chores = 1) ORDER BY id`,
  ).map(toChore);
}

/** A placeholder merged into a user: their turns, swaps and time away follow. */
export function moveChoreMember(db: Db, from: MemberId, into: MemberId): void {
  for (const c of all<{ id: number; rotation: string }>(
    db,
    "SELECT id, rotation FROM chores",
  )) {
    const rotation = JSON.parse(c.rotation) as MemberId[];
    if (!rotation.includes(from)) continue;
    const moved = rotation.map((m) => (m === from ? into : m));
    run(
      db,
      "UPDATE chores SET rotation = ? WHERE id = ?",
      JSON.stringify(moved.filter((m, i) => moved.indexOf(m) === i)),
      c.id,
    );
  }
  run(
    db,
    "UPDATE chore_swaps SET member_id = ? WHERE member_id = ?",
    into,
    from,
  );
  run(
    db,
    "UPDATE chore_away SET member_id = ? WHERE member_id = ?",
    into,
    from,
  );
}
