import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "../services/context.ts";
import { registerAttachments } from "./attachments.ts";
import { registerBalances } from "./balances.ts";
import { registerExpenses } from "./expenses.ts";
import { registerGroups } from "./groups.ts";
import { registerPayments } from "./payments.ts";
import { registerRecurring } from "./recurring.ts";

/** An MCP server whose tools act as `ctx.user` through the services layer. */
export function createServer(ctx: Ctx): McpServer {
  const server = new McpServer(
    { name: "divvy", version: "0.1.0" },
    {
      instructions: `divvy splits bills for ${ctx.user.name} (${ctx.user.email}). Money is integer cents. Before saving anything (add_expense, record_payment, add_recurring, bill_recurring, delete_expense), preview or summarize it and get the user's confirmation.`,
    },
  );
  for (const register of [
    registerGroups,
    registerExpenses,
    registerPayments,
    registerBalances,
    registerRecurring,
    registerAttachments,
  ])
    register(server, ctx);
  return server;
}
