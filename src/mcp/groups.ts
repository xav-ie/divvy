import { z } from "zod";
import { getGroup, listGroups } from "../services/groups.ts";
import { addMember, updatePlaceholder } from "../services/members.ts";
import { updateProfile } from "../services/users.ts";
import { previewVenmo, savedPreview } from "../services/venmoProfile.ts";
import { invalid } from "../services/errors.ts";
import {
  groupArg,
  groupPeople,
  handle,
  personArg,
  resolveGroup,
  type Register,
} from "./tools.ts";

const memberView = (m: {
  id: number;
  name: string;
  placeholder: boolean;
  inviteEmail: string | null;
  isYou?: boolean;
}) => ({
  id: m.id,
  name: m.name,
  placeholder: m.placeholder,
  inviteEmail: m.inviteEmail,
  isYou: m.isYou ?? false,
});

export const registerGroups: Register = (server, ctx) => {
  server.registerTool(
    "list_groups",
    {
      description:
        "List the groups you belong to, with their members. Start here to learn group and member names.",
      annotations: { readOnlyHint: true },
    },
    () =>
      handle(() => ({
        groups: listGroups(ctx).map((g) => {
          const d = getGroup(ctx, g.id);
          return {
            id: g.id,
            name: g.name,
            emoji: g.emoji,
            members: d.members.map(memberView),
          };
        }),
      })),
  );

  server.registerTool(
    "list_members",
    {
      description:
        "List a group's members. Placeholders are people without an account yet.",
      inputSchema: { group: groupArg },
      annotations: { readOnlyHint: true },
    },
    ({ group }) =>
      handle(() => ({
        members: getGroup(ctx, resolveGroup(ctx, group)).members.map(
          memberView,
        ),
      })),
  );

  server.registerTool(
    "add_placeholder",
    {
      description:
        "Add a person without an account to a group (optionally invited by email; they claim the spot when they first sign in). Confirm the name with the user first.",
      inputSchema: {
        group: groupArg,
        name: z.string().describe("Their display name"),
        email: z
          .string()
          .optional()
          .describe(
            "Invite email; if they already have an account they join directly",
          ),
      },
    },
    ({ group, name, email }) =>
      handle(() => ({
        member: memberView(
          addMember(ctx, resolveGroup(ctx, group), { name, email }),
        ),
      })),
  );

  server.registerTool(
    "rename_member",
    {
      description:
        "Rename a placeholder (someone without an account) in a group, and/or invite them by email. Only the group's creator may; people with accounts choose their own names. Confirm with the user first.",
      inputSchema: {
        group: groupArg,
        member: personArg.describe("The placeholder's current name or id"),
        name: z.string().optional().describe("New name"),
        email: z.string().optional().describe("Invite email"),
      },
    },
    ({ group, member, name, email }) =>
      handle(() => {
        const groupId = resolveGroup(ctx, group);
        const m = groupPeople(ctx, groupId).person(member);
        return {
          member: memberView(
            updatePlaceholder(ctx, groupId, m.id, { name, email }),
          ),
        };
      }),
  );

  server.registerTool(
    "set_venmo_username",
    {
      description:
        "Set (or clear with null) your own Venmo username, so people who owe you get a one-tap Venmo pay link. Looks it up on Venmo first and saves only if the profile exists; otherwise it refuses with the reason (not found: check the spelling; couldn't check: try again shortly). Show the user the result.",
      inputSchema: {
        username: z
          .string()
          .nullable()
          .describe(
            "5-30 letters, digits, hyphens or underscores; a leading @ is fine",
          ),
      },
    },
    ({ username }) =>
      handle(async () => {
        if (!username?.trim()) {
          await updateProfile(ctx, { venmo: null });
          return { venmo: null };
        }
        // Only a username Venmo confirms exists is saved.
        const p = await previewVenmo(ctx, { venmo: username });
        if (p.found !== true) throw invalid(p.note!);
        const u = await updateProfile(ctx, {
          venmo: p.username,
          previewId: p.previewId,
        });
        return { venmo: u.venmo, ...savedPreview(u) };
      }),
  );
};
