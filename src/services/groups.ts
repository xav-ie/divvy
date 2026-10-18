import * as repo from "../db/groups.ts";
import type { Member } from "../db/members.ts";
import { transaction } from "../db/transaction.ts";
import { requireGroup, type Ctx } from "./context.ts";
import { forbidden } from "./errors.ts";
import { parse } from "./parse.ts";
import { GroupInput, GroupPatch, id } from "./schemas.ts";

export type { Group } from "../db/groups.ts";

export interface GroupMember extends Member {
  /** This member is the acting user. */
  isYou: boolean;
}

export interface GroupDetail extends repo.Group {
  members: GroupMember[];
  /** The acting user created the group (may rename, delete, remove members). */
  isCreator: boolean;
}

export function createGroup(ctx: Ctx, input: GroupInput): GroupDetail {
  const g = parse(GroupInput, input);
  const groupId = transaction(ctx.db, () => {
    const groupId = repo.insertGroup(ctx.db, { ...g, createdBy: ctx.user.id });
    repo.addGroupMember(ctx.db, groupId, ctx.user.memberId);
    return groupId;
  });
  return getGroup(ctx, groupId);
}

/** Groups the acting user belongs to, by name. */
export function listGroups(ctx: Ctx): repo.Group[] {
  return repo.groupsForMember(ctx.db, ctx.user.memberId);
}

/** A group with its members; 404 unless the acting user is a member. */
export function getGroup(ctx: Ctx, groupId: number): GroupDetail {
  const group = requireGroup(ctx, parse(id, groupId));
  const members = repo
    .groupMembers(ctx.db, group.id)
    .map((m) => ({ ...m, isYou: m.id === ctx.user.memberId }));
  return { ...group, members, isCreator: group.createdBy === ctx.user.id };
}

/** The group, if the acting user created it; otherwise 403 (or 404 for non-members). */
export function requireCreator(
  ctx: Ctx,
  groupId: number,
  action: string,
): repo.Group {
  const group = requireGroup(ctx, parse(id, groupId));
  if (group.createdBy !== ctx.user.id)
    throw forbidden(`Only the person who created the group can ${action}`);
  return group;
}

export function updateGroup(
  ctx: Ctx,
  groupId: number,
  patch: GroupPatch,
): GroupDetail {
  const p = parse(GroupPatch, patch);
  // Any member may toggle simplify; renaming is the creator's.
  const group =
    p.name === undefined && p.emoji === undefined
      ? requireGroup(ctx, parse(id, groupId))
      : requireCreator(ctx, groupId, "rename it");
  repo.updateGroup(ctx.db, group.id, {
    name: p.name ?? group.name,
    emoji: p.emoji ?? group.emoji,
    simplify: p.simplify ?? group.simplify,
  });
  return getGroup(ctx, group.id);
}

/** Delete a group with all its expenses and payments. Creator only. */
export function deleteGroup(ctx: Ctx, groupId: number): void {
  const group = requireCreator(ctx, groupId, "delete it");
  repo.deleteGroup(ctx.db, group.id);
}
