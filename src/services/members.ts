import {
  addGroupMember,
  groupMembers,
  groupsForMember,
  isGroupMember,
  removeGroupMember,
} from "../db/groups.ts";
import {
  getMember,
  insertMember,
  mergeMember,
  placeholdersByEmail,
  renameMember,
  setInviteEmail,
  type Member,
} from "../db/members.ts";
import { listRecurring } from "../db/recurring.ts";
import { transaction } from "../db/transaction.ts";
import { findUserByEmail } from "../db/users.ts";
import { entryDebts, pairwise } from "../domain/balances.ts";
import { ledger } from "./balances.ts";
import { requireGroup, type Ctx } from "./context.ts";
import { conflict, forbidden, invalid, notFound } from "./errors.ts";
import { insertAudit } from "../db/audit.ts";
import { requireCreator } from "./groups.ts";
import { parse } from "./parse.ts";
import { defaultName } from "./users.ts";
import { id, InviteEmailInput, MemberInput, MemberPatch } from "./schemas.ts";

const ONLY_CREATOR =
  "Only the group's creator can change people who haven't joined yet";

/**
 * Add someone to a group. Any member may. With only a name this creates a
 * placeholder. With an email it adds that user if they've signed in before,
 * or creates a new placeholder invited by email (claimed when they first sign
 * in). Placeholders are never shared between groups: one in another group may
 * belong to people the acting user can't see.
 */
export function addMember(
  ctx: Ctx,
  groupId: number,
  input: MemberInput,
): Member {
  const group = requireGroup(ctx, parse(id, groupId));
  const { name, email } = parse(MemberInput, input);
  return transaction(ctx.db, () => {
    if (
      email &&
      groupMembers(ctx.db, group.id).some(
        (m) => m.placeholder && m.inviteEmail === email,
      )
    )
      throw conflict("They're already in this group");
    const user = email ? findUserByEmail(ctx.db, email) : undefined;
    // A new placeholder's invite decides who later takes over its balance, so
    // only the creator may reuse an email someone else was invited with.
    if (
      email &&
      !user &&
      group.createdBy !== ctx.user.id &&
      placeholdersByEmail(ctx.db, email).length > 0
    )
      throw forbidden(
        "Someone was already invited with that email; ask the group's creator to add them",
      );
    const memberId =
      user?.memberId ||
      insertMember(ctx.db, {
        name: name ?? defaultName(email!),
        inviteEmail: email ?? null,
        placeholder: true,
      });
    if (isGroupMember(ctx.db, group.id, memberId))
      throw conflict("They're already in this group");
    addGroupMember(ctx.db, group.id, memberId);
    return getMember(ctx.db, memberId)!;
  });
}

/**
 * Invite an existing placeholder by email (group creator only: the invite
 * decides who takes over the placeholder's balance). If that email already belongs to a
 * user, the placeholder merges into them right away (their shares and
 * payments move over). Refuses placeholders that are also in other groups, so
 * an invite can never carry someone into a group the acting user isn't in.
 * Returns the resulting member.
 */
export function invitePlaceholder(
  ctx: Ctx,
  groupId: number,
  memberId: number,
  input: { email: string },
): Member {
  const group = requireGroup(ctx, parse(id, groupId));
  const { email } = parse(InviteEmailInput, input);
  const member = getMember(ctx.db, parse(id, memberId));
  if (!member || !isGroupMember(ctx.db, group.id, member.id))
    throw notFound("Member");
  if (!member.placeholder)
    throw invalid(`${member.name} already has an account`);
  if (group.createdBy !== ctx.user.id) throw forbidden(ONLY_CREATOR);
  if (groupsForMember(ctx.db, member.id).some((g) => g.id !== group.id))
    throw conflict(
      `${member.name} is also in other groups; add them by email instead`,
    );
  return transaction(ctx.db, () => {
    const user = findUserByEmail(ctx.db, email);
    if (!user) {
      setInviteEmail(ctx.db, member.id, email);
      return getMember(ctx.db, member.id)!;
    }
    mergeMember(ctx.db, member.id, user.memberId);
    return getMember(ctx.db, user.memberId)!;
  });
}

/**
 * Rename a placeholder and/or invite it by email (see invitePlaceholder).
 * Group creator only; people with accounts rename themselves in Profile.
 */
export function updatePlaceholder(
  ctx: Ctx,
  groupId: number,
  memberId: number,
  input: MemberPatch,
): Member {
  const group = requireGroup(ctx, parse(id, groupId));
  const patch = parse(MemberPatch, input);
  const member = getMember(ctx.db, parse(id, memberId));
  if (!member || !isGroupMember(ctx.db, group.id, member.id))
    throw notFound("Member");
  if (!member.placeholder)
    throw member.userId === ctx.user.id
      ? invalid("Change your own name in Profile")
      : forbidden(`${member.name} has an account and picks their own name`);
  if (group.createdBy !== ctx.user.id) throw forbidden(ONLY_CREATOR);
  if (groupsForMember(ctx.db, member.id).some((g) => g.id !== group.id))
    throw conflict(
      `${member.name} is also in other groups; ask them to sign in instead`,
    );
  return transaction(ctx.db, () => {
    if (patch.name !== undefined && patch.name !== member.name) {
      renameMember(ctx.db, member.id, patch.name);
      insertAudit(ctx.db, {
        groupId: group.id,
        userId: ctx.user.id,
        action: "update",
        entity: "member",
        entityId: member.id,
        summary: `renamed ${member.name} to ${patch.name}`,
      });
    }
    return patch.email === undefined
      ? getMember(ctx.db, member.id)!
      : invitePlaceholder(ctx, group.id, member.id, { email: patch.email });
  });
}

/** Remove a member from a group. Creator only; refuses while they have any balance in the group. */
export function removeMember(
  ctx: Ctx,
  groupId: number,
  memberId: number,
): void {
  const group = requireCreator(ctx, groupId, "remove people");
  const member = getMember(ctx.db, parse(id, memberId));
  if (!member || !isGroupMember(ctx.db, group.id, member.id))
    throw notFound("Member");
  if (member.userId === group.createdBy)
    throw invalid(
      "The group's creator can't be removed; delete the group instead",
    );
  const owing = pairwise(ledger(ctx.db, [group.id]).flatMap(entryDebts)).some(
    (d) => d.from === member.id || d.to === member.id,
  );
  if (owing)
    throw conflict(
      `${member.name} still has a balance in this group; settle up first`,
    );
  const templates = listRecurring(ctx.db, group.id).filter(
    (t) => t.payerMemberId === member.id || (t.split[member.id] ?? 0) > 0,
  );
  if (templates.length)
    throw conflict(
      `${member.name} is on recurring ${templates.length === 1 ? "bill" : "bills"} ${templates.map((t) => `"${t.title}"`).join(", ")}; edit or delete ${templates.length === 1 ? "it" : "them"} first`,
    );
  removeGroupMember(ctx.db, group.id, member.id);
}
