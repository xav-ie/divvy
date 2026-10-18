import { insertAudit } from "../db/audit.ts";
import { isGroupMember } from "../db/groups.ts";
import { getMembers } from "../db/members.ts";
import * as repo from "../db/payments.ts";
import { transaction } from "../db/transaction.ts";
import { formatCents } from "../domain/money.ts";
import { requireGroup, requireRestorable, type Ctx } from "./context.ts";
import { forbidden, invalid, notFound } from "./errors.ts";
import { parse } from "./parse.ts";
import { id, PaymentInput } from "./schemas.ts";

export type { Payment } from "../db/payments.ts";

export interface PaymentView extends repo.Payment {
  fromName: string;
  toName: string;
  canEdit: boolean;
}

/** Whoever recorded a payment, paid it or received it may delete it. */
function mayEdit(ctx: Ctx, p: repo.Payment): boolean {
  const me = ctx.user.memberId;
  return (
    p.createdBy === ctx.user.id || p.fromMember === me || p.toMember === me
  );
}

function describe(ctx: Ctx, p: repo.Payment): PaymentView {
  const names = new Map(
    getMembers(ctx.db, [p.fromMember, p.toMember]).map((m) => [m.id, m.name]),
  );
  return {
    ...p,
    fromName: names.get(p.fromMember) ?? "Someone",
    toName: names.get(p.toMember) ?? "Someone",
    canEdit: mayEdit(ctx, p),
  };
}

const summary = (p: PaymentView) =>
  `a payment of ${formatCents(p.cents)} from ${p.fromName} to ${p.toName}`;

/** Record that `fromMember` paid `toMember`. Any member may, for any two members of the group. */
export function recordPayment(
  ctx: Ctx,
  groupId: number,
  input: PaymentInput,
): PaymentView {
  const group = requireGroup(ctx, parse(id, groupId));
  const p = parse(PaymentInput, input);
  if (p.fromMember === p.toMember)
    throw invalid("A payment needs two different people");
  if (
    !isGroupMember(ctx.db, group.id, p.fromMember) ||
    !isGroupMember(ctx.db, group.id, p.toMember)
  ) {
    throw invalid("Both people must be in the group");
  }
  return transaction(ctx.db, () => {
    const paymentId = repo.insertPayment(ctx.db, {
      ...p,
      groupId: group.id,
      createdBy: ctx.user.id,
    });
    const view = describe(ctx, repo.getPayment(ctx.db, paymentId)!);
    insertAudit(ctx.db, {
      groupId: group.id,
      userId: ctx.user.id,
      action: "create",
      entity: "payment",
      entityId: paymentId,
      summary: `recorded ${summary(view)}`,
      data: { fromMember: p.fromMember, toMember: p.toMember, cents: p.cents },
    });
    return view;
  });
}

/** Delete a payment. Its recorder or either person in it. */
export function deletePayment(ctx: Ctx, paymentId: number): void {
  const p = repo.getPayment(ctx.db, parse(id, paymentId));
  if (!p) throw notFound("Payment");
  requireGroup(ctx, p.groupId);
  if (!mayEdit(ctx, p))
    throw forbidden(
      "Only the person who recorded this payment or someone in it can delete it",
    );
  const view = describe(ctx, p);
  transaction(ctx.db, () => {
    repo.deletePayment(ctx.db, p.id, ctx.user.id);
    insertAudit(ctx.db, {
      groupId: p.groupId,
      userId: ctx.user.id,
      action: "delete",
      entity: "payment",
      entityId: p.id,
      summary: `deleted ${summary(view)}`,
      data: { fromMember: p.fromMember, toMember: p.toMember, cents: p.cents },
    });
  });
}

/** Undo a delete within 7 days; whoever could delete it may. */
export function restorePayment(ctx: Ctx, paymentId: number): PaymentView {
  const p = repo.getPayment(ctx.db, parse(id, paymentId), true);
  if (!p) throw notFound("Payment");
  requireGroup(ctx, p.groupId);
  requireRestorable("payment", p.deletedAt);
  if (!mayEdit(ctx, p))
    throw forbidden(
      "Only the person who recorded this payment or someone in it can restore it",
    );
  return transaction(ctx.db, () => {
    repo.restorePayment(ctx.db, p.id);
    const view = describe(ctx, repo.getPayment(ctx.db, p.id)!);
    insertAudit(ctx.db, {
      groupId: p.groupId,
      userId: ctx.user.id,
      action: "restore",
      entity: "payment",
      entityId: p.id,
      summary: `restored ${summary(view)}`,
      data: { fromMember: p.fromMember, toMember: p.toMember, cents: p.cents },
    });
    return view;
  });
}

/** A group's payments, newest first. */
export function listPayments(ctx: Ctx, groupId: number): PaymentView[] {
  const group = requireGroup(ctx, parse(id, groupId));
  return repo.listPayments(ctx.db, [group.id]).map((p) => describe(ctx, p));
}
