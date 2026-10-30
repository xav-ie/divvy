import { getMembers } from "../db/members.ts";
import type { Cents, MemberId } from "../domain/types.ts";
import { todayLocal } from "../domain/recurring.ts";
import { requireGroup, type Ctx } from "./context.ts";
import { parse } from "./parse.ts";
import { id } from "./schemas.ts";
import { listExpenses } from "./expenses.ts";
import { listPayments } from "./payments.ts";
import { groupBalances } from "./balances.ts";

/** One CSV cell: wrap in quotes when needed, double embedded quotes. */
function cell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function row(...cells: (string | number | null)[]): string {
  return cells.map(cell).join(",");
}

function dollars(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

/** "Ana 44.99; Ben 45.00" — member amounts, oldest member id first for stable order. */
function amountsText(
  amounts: Record<MemberId, Cents>,
  names: Map<MemberId, string>,
): string {
  return Object.entries(amounts)
    .map(([memberId, cents]) => [Number(memberId), cents] as [MemberId, Cents])
    .sort((a, b) => a[0] - b[0])
    .map(
      ([memberId, cents]) =>
        `${names.get(memberId) ?? "Someone"} ${dollars(cents)}`,
    )
    .join("; ");
}

export interface GroupExport {
  filename: string;
  csv: string;
}

/**
 * A group's whole ledger as CSV: expenses, payments, and the current net
 * balances, so members can keep records or settle up outside Divvy. Money is
 * decimal dollars (two places); dates are local YYYY-MM-DD as everywhere
 * else. Net is signed: positive means the group owes the member.
 */
export function groupExportCsv(ctx: Ctx, groupId: number): GroupExport {
  const group = requireGroup(ctx, parse(id, groupId));
  const expenses = listExpenses(ctx, group.id);
  const payments = listPayments(ctx, group.id);
  const balances = groupBalances(ctx, group.id);

  const nameIds = [
    ...new Set([
      ...expenses.flatMap((e) => [
        ...Object.keys(e.payers),
        ...Object.keys(e.shares),
      ]),
      ...payments.flatMap((p) => [String(p.fromMember), String(p.toMember)]),
    ]),
  ].map(Number);
  const names = new Map(
    getMembers(ctx.db, nameIds).map(
      (m) => [m.id, m.name] as [MemberId, string],
    ),
  );

  const lines: string[] = [
    row("Expenses"),
    row("Date", "Title", "Paid by", "Total", "Shares"),
    ...expenses.map((e) =>
      row(
        e.date,
        e.title,
        amountsText(e.payers, names),
        dollars(e.totalCents),
        amountsText(e.shares, names),
      ),
    ),
    "",
    row("Payments"),
    row("Date", "From", "To", "Amount", "Note"),
    ...payments.map((p) =>
      row(p.date, p.fromName, p.toName, dollars(p.cents), p.note),
    ),
    "",
    row("Balances (net, positive = owed to member)"),
    row("Member", "Net"),
    ...balances.members.map((m) => row(m.name, dollars(m.cents))),
  ];

  const slug =
    group.name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "") || "group";
  return {
    filename: `divvy-${slug}-${todayLocal()}.csv`,
    csv: `${lines.join("\n")}\n`,
  };
}
