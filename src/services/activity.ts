import { listAudit, type AuditEntry } from "../db/audit.ts";
import { groupsForMember } from "../db/groups.ts";
import { getMembers } from "../db/members.ts";
import { formatCents } from "../domain/money.ts";
import { requireGroup, type Ctx } from "./context.ts";
import { parse } from "./parse.ts";
import { id } from "./schemas.ts";

export interface ActivityItem extends AuditEntry {
  /** The acting user is the viewer. */
  actorIsYou: boolean;
  /** Worded for the viewer: "You added "Dinner" ($133.12)", "Ana paid you $300.00". */
  sentence: string;
}

/** Recent changes, newest first: one group, or every group the acting user is in. */
export function listActivity(
  ctx: Ctx,
  opts: { groupId?: number; limit?: number } = {},
): ActivityItem[] {
  const groupIds =
    opts.groupId === undefined
      ? groupsForMember(ctx.db, ctx.user.memberId).map((g) => g.id)
      : [requireGroup(ctx, parse(id, opts.groupId)).id];
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const entries = listAudit(ctx.db, groupIds, limit);
  const ids = entries.flatMap((a) =>
    [a.data?.fromMember, a.data?.toMember].filter((m) => m !== undefined),
  );
  const names = new Map(getMembers(ctx.db, ids).map((m) => [m.id, m.name]));
  const me = ctx.user.memberId;
  return entries.map((a) => {
    const actorIsYou = a.userId === ctx.user.id;
    const actor = actorIsYou ? "You" : a.userName;
    const d = a.data;
    let sentence = `${actor} ${a.summary}`;
    if (a.entity === "payment" && d?.fromMember && d.toMember && d.cents) {
      const who = (m: number, start: boolean) =>
        m === me ? (start ? "You" : "you") : (names.get(m) ?? "Someone");
      const amount = formatCents(d.cents);
      const paid = `${who(d.fromMember, true)} paid ${who(d.toMember, false)} ${amount}`;
      if (a.action === "delete" || a.action === "restore")
        sentence = `${actor} ${a.action}d a payment (${who(d.fromMember, false)} paid ${who(d.toMember, false)} ${amount})`;
      else if (a.actorMemberId === d.fromMember) sentence = paid;
      else if (a.actorMemberId === d.toMember)
        sentence = `${who(d.toMember, true)} got ${amount} from ${who(d.fromMember, false)}`;
      else
        sentence = `${actor} recorded ${who(d.fromMember, false)} paying ${who(d.toMember, false)} ${amount}`;
    }
    return { ...a, actorIsYou, sentence };
  });
}
