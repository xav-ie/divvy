import { z } from "zod";
import { insertAudit } from "../db/audit.ts";
import * as repo from "../db/chores.ts";
import { getGroup, groupMembers, type Group } from "../db/groups.ts";
import type { Db } from "../db/connection.ts";
import { getMembers } from "../db/members.ts";
import { getUser } from "../db/users.ts";
import { transaction } from "../db/transaction.ts";
import { addDays, turns, type Turn } from "../domain/chores.ts";
import { NAME_MAX } from "../domain/limits.ts";
import { todayLocal } from "../domain/recurring.ts";
import type { LocalDate, MemberId } from "../domain/types.ts";
import { day, formatDate } from "../client/format.ts";
import { requireGroup, type Ctx } from "./context.ts";
import { forbidden, invalid, notFound } from "./errors.ts";
import { pushTo, type PushMessage } from "./notifications.ts";
import { parse } from "./parse.ts";
import { id, localDate } from "./schemas.ts";

export const ChoreInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give the chore a name")
      .max(NAME_MAX, `Names can be at most ${NAME_MAX} characters`),
    instructions: z.string().trim().max(2000).default(""),
    everyDays: z
      .number()
      .int()
      .min(1, "Turns last 1 to 28 days")
      .max(28, "Turns last 1 to 28 days"),
    starts: localDate,
    ends: localDate.nullable().default(null),
    rotation: z
      .array(id)
      .min(1, "Pick at least one person")
      .max(50)
      .refine((r) => new Set(r).size === r.length, "Everyone takes one place"),
  })
  .refine((c) => c.ends === null || c.ends >= c.starts, {
    message: "The last turn can't start before the first",
  });
export const SwapInput = z.object({
  /** The turn's first day. */
  turnStart: localDate,
  /** Who takes it; they give that turn's person their next turn in exchange. */
  memberId: id,
});
export const AwayInput = z
  .object({
    memberId: id,
    from: localDate,
    /** The day they're back. */
    until: localDate,
  })
  .refine((a) => a.from < a.until, {
    message: "They have to be back after they leave",
  });

export type ChoreInput = z.input<typeof ChoreInput>;
export type ChorePatch = Partial<ChoreInput>;
export type SwapInput = z.input<typeof SwapInput>;
export type AwayInput = z.input<typeof AwayInput>;

export interface ChoreView extends repo.Chore {
  /** The turn under way today; null before the first or after the last. */
  current: Turn | null;
  /** From yesterday's turn on, at most a year ahead. */
  turns: Turn[];
  /** The acting user added the chore or created the group, so may edit or delete it. */
  canEdit: boolean;
}

export interface AwayView extends repo.Away {
  /** The acting user is the one away, added it, or created the group. */
  canEdit: boolean;
}

export interface ChoresOverview {
  chores: ChoreView[];
  away: AwayView[];
}

const SCHEDULE_DAYS = 366;

function requireChoresGroup(ctx: Ctx, groupId: number): Group {
  const group = requireGroup(ctx, parse(id, groupId));
  if (!group.chores) throw invalid("Chores are turned off for this group");
  return group;
}

function requireChore(ctx: Ctx, choreId: number): repo.Chore {
  const c = repo.getChore(ctx.db, parse(id, choreId));
  if (!c) throw notFound("Chore");
  requireChoresGroup(ctx, c.groupId);
  return c;
}

const canEditChore = (ctx: Ctx, c: repo.Chore, group: Group) =>
  c.createdBy === ctx.user.id || group.createdBy === ctx.user.id;

function requireEditable(
  ctx: Ctx,
  choreId: number,
  action: string,
): repo.Chore {
  const c = requireChore(ctx, choreId);
  if (!canEditChore(ctx, c, requireGroup(ctx, c.groupId)))
    throw forbidden(
      `Only the person who added this chore or the group's creator can ${action} it`,
    );
  return c;
}

function schedule(
  ctx: Ctx,
  c: repo.Chore,
  from: LocalDate,
  days = SCHEDULE_DAYS,
): Turn[] {
  return turns(
    c,
    repo.listAway(ctx.db, c.groupId),
    repo.choreSwaps(ctx.db, c.id),
    { from, until: addDays(from, days) },
  );
}

function view(ctx: Ctx, c: repo.Chore, group: Group, today: LocalDate) {
  // From yesterday: the server's day runs ahead of evenings west of UTC.
  const upcoming = schedule(ctx, c, addDays(today, -1));
  const first = upcoming.find((t) => t.end >= today);
  return {
    ...c,
    current: first && first.start <= today ? first : null,
    turns: upcoming,
    canEdit: canEditChore(ctx, c, group),
  };
}

function build(ctx: Ctx, groupId: number, raw: unknown): repo.ChoreWrite {
  const c = parse(ChoreInput, raw);
  const members = new Set(groupMembers(ctx.db, groupId).map((m) => m.id));
  if (c.rotation.some((m) => !members.has(m)))
    throw invalid("Everyone in a chore's rotation must be in the group");
  return { ...c, groupId };
}

function audit(
  ctx: Ctx,
  groupId: number,
  action: "create" | "update" | "delete",
  entityId: number,
  summary: string,
): void {
  insertAudit(ctx.db, {
    groupId,
    userId: ctx.user.id,
    action,
    entity: "chore",
    entityId,
    summary,
  });
}

function namer(ctx: Ctx, groupId: number) {
  const names = new Map(
    groupMembers(ctx.db, groupId).map((m) => [m.id, m.name]),
  );
  return (m: MemberId | null) =>
    (m !== null && names.get(m)) || "a former member";
}

/** A group's chores with who's up, and everyone's time away. */
export function listChores(
  ctx: Ctx,
  groupId: number,
  today = todayLocal(),
): ChoresOverview {
  const group = requireChoresGroup(ctx, groupId);
  const me = ctx.user.memberId;
  return {
    chores: repo
      .listChores(ctx.db, group.id)
      .map((c) => view(ctx, c, group, today)),
    away: repo
      .listAway(ctx.db, group.id)
      .filter((a) => a.until > today)
      .map((a) => ({
        ...a,
        canEdit:
          a.memberId === me ||
          a.createdBy === ctx.user.id ||
          group.createdBy === ctx.user.id,
      })),
  };
}

/** Add a chore to a group. Any member may. */
export function createChore(
  ctx: Ctx,
  groupId: number,
  input: ChoreInput,
  today = todayLocal(),
): ChoreView {
  const group = requireChoresGroup(ctx, groupId);
  const c = build(ctx, group.id, input);
  const choreId = transaction(ctx.db, () => {
    const choreId = repo.insertChore(ctx.db, c, ctx.user.id);
    audit(ctx, group.id, "create", choreId, `added the chore "${c.name}"`);
    return choreId;
  });
  return view(ctx, repo.getChore(ctx.db, choreId)!, group, today);
}

/**
 * Change some fields. Moving the first day or the turn length moves every
 * turn, so swaps are dropped then. Chore or group creator only.
 */
export function updateChore(
  ctx: Ctx,
  choreId: number,
  patch: ChorePatch,
  today = todayLocal(),
): ChoreView {
  const c = requireEditable(ctx, choreId, "edit");
  const next = build(ctx, c.groupId, { ...c, ...patch });
  transaction(ctx.db, () => {
    repo.updateChore(ctx.db, c.id, next);
    if (next.starts !== c.starts || next.everyDays !== c.everyDays)
      repo.clearSwaps(ctx.db, c.id);
    audit(ctx, c.groupId, "update", c.id, `edited the chore "${next.name}"`);
  });
  const group = requireGroup(ctx, c.groupId);
  return view(ctx, repo.getChore(ctx.db, c.id)!, group, today);
}

/** Delete a chore and its swaps. Chore or group creator only. */
export function deleteChore(ctx: Ctx, choreId: number): void {
  const c = requireEditable(ctx, choreId, "delete");
  transaction(ctx.db, () => {
    repo.deleteChore(ctx.db, c.id);
    audit(ctx, c.groupId, "delete", c.id, `deleted the chore "${c.name}"`);
  });
}

/**
 * Trade a turn: `memberId` takes the turn starting `turnStart`, and its
 * person takes `memberId`'s next turn after it. Swapping back undoes it.
 * Either of the two people or the group's creator may.
 */
export function swapTurn(
  ctx: Ctx,
  choreId: number,
  input: SwapInput,
  today = todayLocal(),
): ChoreView {
  const c = requireChore(ctx, choreId);
  const s = parse(SwapInput, input);
  const group = requireGroup(ctx, c.groupId);
  const name = namer(ctx, c.groupId);
  const upcoming = schedule(ctx, c, today);
  const i = upcoming.findIndex((t) => t.start === s.turnStart);
  const turn = upcoming[i];
  if (!turn) throw invalid("That turn is over or isn't on the schedule");
  const was = turn.memberId;
  if (was === null) throw invalid("Nobody has that turn; everyone is away");
  if (was === s.memberId)
    throw invalid(`It's already ${name(s.memberId)}'s turn`);
  if (!groupMembers(ctx.db, c.groupId).some((m) => m.id === s.memberId))
    throw invalid("Swap with someone in the group");
  const me = ctx.user.memberId;
  if (me !== was && me !== s.memberId && group.createdBy !== ctx.user.id)
    throw forbidden(
      "Only the two people swapping or the group's creator can swap turns",
    );
  const later = upcoming.slice(i + 1).find((t) => t.memberId === s.memberId);
  if (!later)
    throw invalid(`${name(s.memberId)} has no later turn to swap with`);
  // A turn handed back to whoever had it before any swap needs no swap row.
  const give = (t: Turn, to: MemberId) =>
    repo.setSwap(
      ctx.db,
      c.id,
      t.start,
      to === (t.swappedFrom ?? t.memberId) ? null : to,
    );
  transaction(ctx.db, () => {
    give(turn, s.memberId);
    give(later, was);
    audit(
      ctx,
      c.groupId,
      "update",
      c.id,
      `swapped ${c.name}: ${name(s.memberId)} takes ${formatDate(turn.start)}, ${name(was)} takes ${formatDate(later.start)}`,
    );
  });
  notifySwap(ctx, c, group, [
    { memberId: s.memberId, takes: turn, gives: later, other: was },
    { memberId: was, takes: later, gives: turn, other: s.memberId },
  ]);
  return view(ctx, repo.getChore(ctx.db, c.id)!, group, today);
}

/** Mark someone away; their turns go to the next person. Yourself, or anyone if you created the group. */
export function addAway(ctx: Ctx, groupId: number, input: AwayInput): AwayView {
  const group = requireChoresGroup(ctx, groupId);
  const a = parse(AwayInput, input);
  if (!groupMembers(ctx.db, group.id).some((m) => m.id === a.memberId))
    throw invalid("Only people in the group can be away");
  if (a.memberId !== ctx.user.memberId && group.createdBy !== ctx.user.id)
    throw forbidden("Only the group's creator can mark someone else away");
  const name = namer(ctx, group.id);
  const awayId = transaction(ctx.db, () => {
    const awayId = repo.insertAway(
      ctx.db,
      { ...a, groupId: group.id },
      ctx.user.id,
    );
    audit(
      ctx,
      group.id,
      "create",
      awayId,
      `marked ${name(a.memberId)} away from chores ${formatDate(a.from)} until ${formatDate(a.until)}`,
    );
    return awayId;
  });
  return { ...repo.getAway(ctx.db, awayId)!, canEdit: true };
}

/** End time away early or take it back. Whoever is away, added it, or the group's creator. */
export function deleteAway(ctx: Ctx, awayId: number): void {
  const a = repo.getAway(ctx.db, parse(id, awayId));
  if (!a) throw notFound("Time away");
  const group = requireChoresGroup(ctx, a.groupId);
  if (
    a.memberId !== ctx.user.memberId &&
    a.createdBy !== ctx.user.id &&
    group.createdBy !== ctx.user.id
  )
    throw forbidden(
      "Only the person who's away, whoever added it, or the group's creator can remove it",
    );
  const name = namer(ctx, a.groupId);
  transaction(ctx.db, () => {
    repo.deleteAway(ctx.db, a.id);
    audit(
      ctx,
      a.groupId,
      "delete",
      a.id,
      `removed ${name(a.memberId)}'s time away from chores`,
    );
  });
}

export interface MyTurn {
  groupId: number;
  choreId: number;
  chore: string;
  turn: Turn;
}

/** The acting user's turn under way or next, per chore, across groups with chores on. */
export function myTurns(
  ctx: Ctx,
  groups: Group[],
  today = todayLocal(),
): MyTurn[] {
  const me = ctx.user.memberId;
  return groups
    .filter((g) => g.chores)
    .flatMap((g) =>
      repo.listChores(ctx.db, g.id).flatMap((c) => {
        const turn = schedule(ctx, c, today).find((t) => t.memberId === me);
        return turn
          ? [{ groupId: g.id, choreId: c.id, chore: c.name, turn }]
          : [];
      }),
    )
    .sort((a, b) => a.turn.start.localeCompare(b.turn.start));
}

const groupLabel = (g: Group) => `${g.emoji} ${g.name}`.trim();

/** Tell the people in a swap (except whoever made it) which turn they have now. */
function notifySwap(
  ctx: Ctx,
  c: repo.Chore,
  group: Group,
  sides: { memberId: MemberId; takes: Turn; gives: Turn; other: MemberId }[],
): void {
  const name = namer(ctx, c.groupId);
  const users = new Map(
    getMembers(
      ctx.db,
      sides.map((x) => x.memberId),
    ).map((m) => [m.id, m.userId]),
  );
  const messages = new Map<number, PushMessage>();
  for (const x of sides) {
    const userId = users.get(x.memberId);
    if (!userId || userId === ctx.user.id) continue;
    messages.set(userId, {
      title: `${ctx.user.name} swapped ${c.name}`,
      body: `You now have ${day(x.takes.start)} instead of ${day(x.gives.start)}; ${name(x.other)} has the other. ${groupLabel(group)}`,
      url: `/groups/${c.groupId}?tab=chores`,
    });
  }
  pushTo(ctx.db, ctx.user.email, "chores", messages);
}

/**
 * Push "your turn" to whoever's turn starts today, once per turn, signed as
 * the group's creator. Run daily by the cron; returns how many it sent.
 */
export function remindTurns(db: Db, today = todayLocal()): number {
  let sent = 0;
  for (const c of repo.activeChores(db)) {
    const group = getGroup(db, c.groupId)!;
    const turn = turns(
      c,
      repo.listAway(db, c.groupId),
      repo.choreSwaps(db, c.id),
      { from: today, until: addDays(today, 1) },
    ).find((t) => t.start === today);
    if (!turn || turn.memberId === null) continue;
    const userId = getMembers(db, [turn.memberId])[0]?.userId;
    const signer = getUser(db, group.createdBy);
    if (!userId || !signer || !repo.claimReminder(db, c.id, turn.start))
      continue;
    const steps = c.instructions.split("\n").filter((l) => l.trim()).length;
    pushTo(
      db,
      signer.email,
      "chores",
      new Map([
        [
          userId,
          {
            title: `Your turn: ${c.name}`,
            body: `Until ${day(turn.end)}${steps ? `; tap for what to do` : ""}. ${groupLabel(group)}`,
            url: `/groups/${c.groupId}?tab=chores`,
          },
        ],
      ]),
    );
    sent++;
  }
  return sent;
}
