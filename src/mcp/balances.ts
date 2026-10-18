import { z } from "zod";
import {
  groupBalances,
  homeSummary,
  personDrillDown,
} from "../services/balances.ts";
import {
  groupArg,
  groupPeople,
  handle,
  personArg,
  resolveGroup,
  type Register,
} from "./tools.ts";
import { invalid } from "../services/errors.ts";
import { listGroups } from "../services/groups.ts";

export const registerBalances: Register = (server, ctx) => {
  server.registerTool(
    "balances",
    {
      description: `Who owes whom, always as sentences ("Ana owes you $42.10"); cents are positive when the person owes you.
- no arguments: your overall position and everyone you have a balance with, across all groups
- group: every pair in that group, the simplified settle-up plan, and each member's total
- person (optionally with group): the drill-down, every bill and payment between you and them, newest first, with a running total ending at the headline`,
      inputSchema: {
        group: groupArg.optional(),
        person: personArg.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ group, person }) =>
      handle(() => {
        const groupId =
          group === undefined ? undefined : resolveGroup(ctx, group);
        if (person !== undefined) {
          // Look the name up in the given group, or in any of your groups.
          const ids = groupId ? [groupId] : listGroups(ctx).map((g) => g.id);
          const found = new Map<number, string>();
          let error: unknown;
          for (const id of ids) {
            try {
              const m = groupPeople(ctx, id).person(person);
              found.set(m.id, m.name);
            } catch (e) {
              error = e;
            }
          }
          if (found.size === 0)
            throw error ?? invalid(`No member called "${person}"`);
          if (found.size > 1)
            throw invalid(
              `"${person}" could be ${[...found].map(([id, n]) => `${n} (id ${id})`).join(", ")}; use the id`,
            );
          return {
            drillDown: personDrillDown(ctx, [...found.keys()][0]!, groupId),
          };
        }
        if (groupId !== undefined)
          return { group: groupBalances(ctx, groupId) };
        return { overall: homeSummary(ctx) };
      }),
  );
};
