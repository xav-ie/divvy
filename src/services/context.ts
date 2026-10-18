import type { Db } from "../db/connection.ts";
import { getGroup, isGroupMember, type Group } from "../db/groups.ts";
import type { User } from "../db/users.ts";
import { invalid, notFound } from "./errors.ts";

/** Who is acting and against which database. Every service takes one. */
export interface Ctx {
  db: Db;
  user: User;
}

/** The group, if the acting user is a member; otherwise a 404. */
export function requireGroup(ctx: Ctx, groupId: number): Group {
  const group = getGroup(ctx.db, groupId);
  if (!group || !isGroupMember(ctx.db, groupId, ctx.user.memberId))
    throw notFound("Group");
  return group;
}

/** How long a deleted expense or payment can be restored. */
const RESTORE_DAYS = 7;

/** Throws unless `deletedAt` is set and within the restore window. */
export function requireRestorable(
  what: string,
  deletedAt: string | null,
  now = Date.now(),
): void {
  if (!deletedAt) throw invalid(`This ${what} isn't deleted`);
  if (now - Date.parse(deletedAt) > RESTORE_DAYS * 86_400_000)
    throw invalid(
      `This ${what} was deleted more than ${RESTORE_DAYS} days ago and can't be restored`,
    );
}
