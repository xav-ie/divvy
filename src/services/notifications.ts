import type { Db } from "../db/connection.ts";
import type { Expense } from "../db/expenses.ts";
import { getGroup } from "../db/groups.ts";
import { getMembers } from "../db/members.ts";
import type { Payment } from "../db/payments.ts";
import * as repo from "../db/push.ts";
import { formatCents } from "../domain/money.ts";
import {
  generateVapidKeys,
  sendPush,
  type VapidKeys,
} from "../push/webpush.ts";
import type { Ctx } from "./context.ts";
import { parse } from "./parse.ts";
import { NotifyInput, SubscriptionInput } from "./schemas.ts";

/** What the service worker shows (public/sw.js). */
interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
}

export interface PushSettings extends repo.NotifyPrefs {
  /** The `applicationServerKey` browsers subscribe with. */
  publicKey: string;
}

/** The household's VAPID key pair, made and saved the first time it's needed. */
async function vapidKeys(db: Db): Promise<VapidKeys> {
  if (!repo.getVapid(db)) {
    const made = await generateVapidKeys();
    repo.insertVapid(db, {
      publicKey: made.publicKey,
      privateJwk: JSON.stringify(made.privateJwk),
    });
  }
  const row = repo.getVapid(db)!;
  return { publicKey: row.publicKey, privateJwk: JSON.parse(row.privateJwk) };
}

export async function getPushSettings(ctx: Ctx): Promise<PushSettings> {
  return {
    ...repo.getPrefs(ctx.db, ctx.user.id),
    publicKey: (await vapidKeys(ctx.db)).publicKey,
  };
}

export function updateNotifyPrefs(
  ctx: Ctx,
  input: NotifyInput,
): repo.NotifyPrefs {
  const prefs = parse(NotifyInput, input);
  for (const kind of ["expenses", "payments"] as const)
    if (prefs[kind] !== undefined)
      repo.setPref(ctx.db, ctx.user.id, kind, prefs[kind]);
  return repo.getPrefs(ctx.db, ctx.user.id);
}

/** Send this device the acting user's notifications. */
export function subscribe(ctx: Ctx, input: SubscriptionInput): void {
  const s = parse(SubscriptionInput, input);
  repo.upsertSubscription(ctx.db, {
    userId: ctx.user.id,
    endpoint: s.endpoint,
    ...s.keys,
  });
}

/** Stop sending to this device (only the acting user's own). */
export function unsubscribe(ctx: Ctx, endpoint: string): void {
  repo.deleteSubscription(ctx.db, endpoint, ctx.user.id);
}

const inflight = new Set<Promise<void>>();

/** Resolves once every push started so far has been sent or given up on. */
export async function pushesSettled(): Promise<void> {
  await Promise.all(inflight);
}

/**
 * Push each user their message on every device that wants `kind`, in the
 * background: the change that caused it is already saved and answered.
 * Subscriptions the push service says are gone are forgotten.
 */
function deliver(
  ctx: Ctx,
  kind: repo.NotifyKind,
  messages: Map<number, PushMessage>,
): void {
  const subs = repo.subscriptionsFor(ctx.db, [...messages.keys()], kind);
  if (subs.length === 0) return;
  const subject = `mailto:${ctx.user.email}`;
  const job = vapidKeys(ctx.db).then((vapid) =>
    Promise.all(
      subs.map(async (s) => {
        try {
          const status = await sendPush(
            s,
            messages.get(s.userId),
            vapid,
            subject,
          );
          if (status === 404 || status === 410)
            repo.deleteSubscription(ctx.db, s.endpoint);
          else if (status >= 400)
            console.error(`Push to ${new URL(s.endpoint).host}: ${status}`);
        } catch (err) {
          console.error("Push failed", err);
        }
      }),
    ).then(() => undefined),
  );
  inflight.add(job);
  void job.finally(() => inflight.delete(job));
}

/** Users behind these members, minus the acting user. */
function othersAmong(ctx: Ctx, memberIds: number[]) {
  return getMembers(ctx.db, memberIds).filter(
    (m) => m.userId !== null && m.userId !== ctx.user.id,
  ) as { id: number; userId: number; name: string }[];
}

const groupLabel = (ctx: Ctx, groupId: number) => {
  const g = getGroup(ctx.db, groupId);
  return g ? `${g.emoji} ${g.name}`.trim() : "";
};

/** Tell everyone else on a new expense what it means for them. Recurring bills stay quiet. */
export function notifyExpense(ctx: Ctx, e: Expense): void {
  if (e.recurringId) return;
  const ids = [...Object.keys(e.shares), ...Object.keys(e.payers)].map(Number);
  const group = groupLabel(ctx, e.groupId);
  const messages = new Map<number, PushMessage>();
  for (const m of othersAmong(ctx, [...new Set(ids)])) {
    const share = e.shares[m.id] ?? 0;
    const paid = e.payers[m.id] ?? 0;
    if (!share && !paid) continue;
    const said = [
      paid && `You paid ${formatCents(paid)}`,
      share && `${paid ? "your" : "Your"} share is ${formatCents(share)}`,
    ].filter(Boolean);
    messages.set(m.userId, {
      title: `${ctx.user.name} added ${e.title}`,
      body: `${said.join("; ")}. ${group}`.trim(),
      url: `/expenses/${e.id}`,
    });
  }
  deliver(ctx, "expenses", messages);
}

/** Tell the payer and payee (whoever didn't record it) about a new payment. */
export function notifyPayment(ctx: Ctx, p: Payment): void {
  const people = getMembers(ctx.db, [p.fromMember, p.toMember]);
  const name = (id: number) =>
    people.find((m) => m.id === id)?.name ?? "Someone";
  const amount = formatCents(p.cents);
  const group = groupLabel(ctx, p.groupId);
  const messages = new Map<number, PushMessage>();
  for (const m of othersAmong(ctx, [p.fromMember, p.toMember]))
    messages.set(m.userId, {
      title: `${ctx.user.name} recorded a payment`,
      body: `${
        m.id === p.fromMember
          ? `You paid ${name(p.toMember)} ${amount}`
          : `${name(p.fromMember)} paid you ${amount}`
      }. ${group}`.trim(),
      url: `/groups/${p.groupId}`,
    });
  deliver(ctx, "payments", messages);
}
