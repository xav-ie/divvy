import { z } from "zod";
import { formatCents } from "../domain/money.ts";
import { todayLocal } from "../domain/recurring.ts";
import { recordPayment } from "../services/payments.ts";
import {
  centsArg,
  groupArg,
  groupPeople,
  handle,
  personArg,
  resolveGroup,
  type Register,
} from "./tools.ts";

export const registerPayments: Register = (server, ctx) => {
  server.registerTool(
    "record_payment",
    {
      description:
        "Record that one person paid another back (settling up). Confirm who paid whom and the amount with the user first; use balances to find the amount owed.",
      inputSchema: {
        group: groupArg,
        from: personArg.describe("Who paid"),
        to: personArg.describe("Who received the money"),
        amount_cents: centsArg.positive(),
        date: z.string().optional().describe("YYYY-MM-DD, default today"),
        note: z.string().optional(),
      },
    },
    (a) =>
      handle(() => {
        const groupId = resolveGroup(ctx, a.group);
        const p = groupPeople(ctx, groupId);
        const payment = recordPayment(ctx, groupId, {
          fromMember: p.person(a.from).id,
          toMember: p.person(a.to).id,
          cents: a.amount_cents,
          date: a.date ?? todayLocal(),
          note: a.note ?? "",
        });
        return {
          payment: {
            sentence: `${payment.fromName} paid ${payment.toName} ${formatCents(payment.cents)}`,
            ...payment,
          },
        };
      }),
  );
};
