import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { formatCents } from "../domain/money.ts";
import type { Amounts } from "../domain/types.ts";
import type { Ctx } from "../services/context.ts";
import { invalid, ServiceError } from "../services/errors.ts";
import { getGroup, listGroups, type GroupMember } from "../services/groups.ts";

/** Registers one tool family against the acting user's context. */
export type Register = (server: McpServer, ctx: Ctx) => void;

/** Structured result plus the same JSON as text for clients that ignore structuredContent. */
function ok(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/** Run a handler; ServiceErrors become tool errors the assistant can read and fix. */
export async function handle(
  fn: () => Record<string, unknown> | Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    if (!(err instanceof ServiceError)) throw err;
    const extra = Object.keys(err.data).length
      ? ` ${JSON.stringify(err.data)}`
      : "";
    return {
      content: [{ type: "text", text: err.message + extra }],
      isError: true,
    };
  }
}

export const groupArg = z
  .string()
  .describe("Group name (case-insensitive, unique prefix is fine) or id");
export const personArg = z
  .string()
  .describe(
    'Member name as listed by list_members (case-insensitive, unique prefix is fine), "me", or a member id',
  );
export const centsArg = z
  .number()
  .int()
  .nonnegative()
  .describe("Integer cents: $12.34 is 1234");

/** Exact match first (case-insensitive), then a unique prefix; errors list the choices. */
function pick<T>(
  items: T[],
  ref: string,
  label: (t: T) => string,
  idOf: (t: T) => number,
  what: string,
): T {
  const q = ref.trim().toLowerCase();
  if (/^\d+$/.test(q)) {
    const byId = items.find((t) => idOf(t) === Number(q));
    if (byId) return byId;
  }
  const exact = items.filter((t) => label(t).toLowerCase() === q);
  const matches = exact.length
    ? exact
    : items.filter((t) => label(t).toLowerCase().startsWith(q));
  const list = (ts: T[]) =>
    ts.map((t) => `${label(t)} (id ${idOf(t)})`).join(", ");
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    throw invalid(
      `"${ref}" could be ${list(matches)}; use the id or the full name`,
    );
  throw invalid(
    `No ${what} called "${ref}". ${items.length ? `Choices: ${list(items)}` : `There are no ${what}s`}`,
  );
}

export function resolveGroup(ctx: Ctx, ref: string): number {
  return pick(
    listGroups(ctx),
    ref,
    (g) => g.name,
    (g) => g.id,
    "group",
  ).id;
}

/** A group's members and a resolver for names in it ("me" is the acting user). */
export function groupPeople(ctx: Ctx, groupId: number) {
  const members = getGroup(ctx, groupId).members;
  const names = new Map(members.map((m) => [m.id, m.name]));
  const person = (ref: string): GroupMember =>
    ["me", "you", "i", "myself"].includes(ref.trim().toLowerCase())
      ? members.find((m) => m.isYou)!
      : pick(
          members,
          ref,
          (m) => m.name,
          (m) => m.id,
          "member",
        );
  /** `{ name: value }` -> `{ memberId: value }`. */
  const byId = (rec: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(rec).map(([k, v]) => [String(person(k).id), v]),
    );
  /** `{ memberId: cents }` -> readable rows. */
  const named = (amounts: Amounts) =>
    Object.entries(amounts).map(([id, cents]) => ({
      memberId: Number(id),
      name: names.get(Number(id)) ?? "Someone",
      cents,
      amount: formatCents(cents),
    }));
  return { members, names, person, byId, named };
}
