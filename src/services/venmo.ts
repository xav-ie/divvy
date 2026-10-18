import { groupsForMember } from "../db/groups.ts";
import { getMember } from "../db/members.ts";
import { getUser, venmoOfMembers } from "../db/users.ts";
import { netBetween } from "../domain/balances.ts";
import type { Cents } from "../domain/types.ts";
import { venmoPayUrl } from "../domain/venmo.ts";
import { effectiveDebts, ledger } from "./balances.ts";
import { requireGroup, type Ctx } from "./context.ts";

/** The payment to record once the viewer confirms they paid on Venmo. */
export interface PlannedPayment {
  groupId: number;
  fromMember: number;
  toMember: number;
  cents: Cents;
}

/** Paying one person what the viewer owes them in one group. */
export interface VenmoPay {
  name: string;
  /** divvy's copy of their Venmo photo, if one was found (helps confirm the payee). */
  photo: string | null;
  groupName: string;
  cents: Cents;
  url: string;
  payment: PlannedPayment;
}

export interface VenmoPlan {
  /** One per group where the viewer owes them (never the other way). */
  pays: VenmoPay[];
  /** Groups with any balance between the two, in either direction. */
  groups: number;
}

/**
 * Venmo pay links for what the viewer owes `memberId`, one per group (or
 * just `groupId`), as each group shows it. Balances are never netted across
 * groups, and nothing is offered where they owe the viewer. Null when they
 * have no Venmo username.
 */
export function venmoPlan(
  ctx: Ctx,
  memberId: number,
  groupId?: number,
): VenmoPlan | null {
  const me = ctx.user.memberId;
  const username = venmoOfMembers(ctx.db, [memberId]).get(memberId);
  if (!username || memberId === me) return null;
  const member = getMember(ctx.db, memberId);
  const name = member?.name ?? "them";
  const payee = member?.userId ? getUser(ctx.db, member.userId) : undefined;
  const photo = payee?.hasVenmoAvatar
    ? `/api/users/${payee.id}/venmo-avatar`
    : null;
  const groups =
    groupId === undefined
      ? groupsForMember(ctx.db, me)
      : [requireGroup(ctx, groupId)];
  const plan: VenmoPlan = { pays: [], groups: 0 };
  for (const g of groups) {
    const net = netBetween(
      effectiveDebts(ledger(ctx.db, [g.id]), [g]),
      me,
      memberId,
    );
    if (net === 0) continue;
    plan.groups++;
    if (net > 0) continue;
    plan.pays.push({
      name,
      photo,
      groupName: g.name,
      cents: -net,
      url: venmoPayUrl(username, -net, `divvy: ${g.name}`),
      payment: {
        groupId: g.id,
        fromMember: me,
        toMember: memberId,
        cents: -net,
      },
    });
  }
  return plan;
}

/** The single pay link when everything owed to them sits in one group (Home's rule). */
export function singleGroupPay(plan: VenmoPlan | null): VenmoPay | null {
  return plan?.groups === 1 && plan.pays.length === 1 ? plan.pays[0]! : null;
}
