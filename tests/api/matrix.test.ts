import { beforeAll, expect, it } from "vitest";
import { apiClient } from "./client.ts";

/**
 * Route × role authorization matrix. Every deny is asserted with its exact
 * status and a stable fragment of its message, so accidental auth loosening
 * (or tightening) fails loudly. Roles: anonymous (unknown dev user), EVE
 * (signed in, not a member), BEN/DEE (members, not creators), ANA (creator).
 */
const ANA = "ana@example.com";
const BEN = "ben@example.com";
const DEE = "dee@example.com";
const EVE = "eve@example.com";

const call = await apiClient([ANA, BEN, DEE, EVE], {
  DIVVY_VENMO_LOOKUP: "off",
});

let gid = 0;
let anaMember = 0;
let benMember = 0;
let zedMember = 0;
let expenseId = 0;
let paymentId = 0;
let recurringId = 0;
let tokenId = 0;
let anaEmailId = 0;
let attachmentId = 0;

const j = async (res: { body: any }) => res.body;

beforeAll(async () => {
  anaMember = (await j(await call("GET", "/api/me", { as: ANA }))).memberId;

  gid = (
    await j(
      await call("POST", "/api/groups", { as: ANA, body: { name: "Flat" } }),
    )
  ).id;
  benMember = (
    await j(
      await call("POST", `/api/groups/${gid}/members`, {
        as: ANA,
        body: { email: BEN },
      }),
    )
  ).id;
  // DEE joins via the API too (her memberId isn't needed, only her membership).
  await call("POST", `/api/groups/${gid}/members`, {
    as: ANA,
    body: { email: DEE },
  });
  zedMember = (
    await j(
      await call("POST", `/api/groups/${gid}/members`, {
        as: ANA,
        body: { name: "Zed" },
      }),
    )
  ).id;

  expenseId = (
    await j(
      await call("POST", `/api/groups/${gid}/expenses`, {
        as: ANA,
        body: {
          items: [
            {
              name: "Groceries",
              quantity: 1,
              unitCents: 9001,
              splitType: "equal",
              split: { [anaMember]: 1, [benMember]: 1 },
            },
          ],
          payers: { [anaMember]: 9001 },
          date: "2026-10-01",
          title: "Groceries",
        },
      }),
    )
  ).id;

  paymentId = (
    await j(
      await call("POST", `/api/groups/${gid}/payments`, {
        as: ANA,
        body: {
          fromMember: benMember,
          toMember: anaMember,
          cents: 1000,
          date: "2026-10-03",
          note: "",
        },
      }),
    )
  ).id;

  recurringId = (
    await j(
      await call("POST", `/api/groups/${gid}/recurring`, {
        as: ANA,
        body: {
          title: "Internet",
          dayOfMonth: 28,
          amountCents: 8999,
          split: { [anaMember]: 1, [benMember]: 1 },
          payerMemberId: anaMember,
        },
      }),
    )
  ).id;

  // Unknown ids still exercise the right code path (404 for everyone but the
  // owner), so a shape surprise can't silently turn the row into a pass.
  tokenId =
    (
      await j(
        await call("POST", "/api/tokens", {
          as: ANA,
          body: { name: "matrix" },
        }),
      )
    ).id ?? 999_999;
  const emails = (await j(await call("GET", "/api/me/emails", { as: ANA })))
    .emails;
  anaEmailId = (Array.isArray(emails) ? emails[0]?.id : undefined) ?? 999_999;

  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "doc.pdf", {
      type: "application/pdf",
    }),
  );
  attachmentId =
    (await j(await call("POST", "/api/attachments", { as: ANA, form }))).id ??
    999_999;
});

interface Row {
  label: string;
  method: string;
  path: () => string;
  as?: string | null;
  /** Exact expected status, or `ok: true` for "anything that isn't an error". */
  status?: number;
  ok?: boolean;
  body?: unknown;
  form?: () => FormData;
  error?: string; // substring of body.error
}

const pdfForm = () => {
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "doc.pdf", {
      type: "application/pdf",
    }),
  );
  return form;
};

const rows: Row[] = [
  // Anonymous: everything behind sign-in.
  {
    label: "anonymous: list groups",
    method: "GET",
    path: () => "/api/groups",
    as: null,
    status: 401,
    error: "Sign in required",
  },
  {
    label: "anonymous: create group",
    method: "POST",
    path: () => "/api/groups",
    as: null,
    body: { name: "X" },
    status: 401,
  },
  {
    label: "anonymous: me",
    method: "GET",
    path: () => "/api/me",
    as: null,
    status: 401,
  },
  {
    label: "anonymous: balances",
    method: "GET",
    path: () => "/api/balances",
    as: null,
    status: 401,
  },
  {
    label: "anonymous: group",
    method: "GET",
    path: () => `/api/groups/${gid}`,
    as: null,
    status: 401,
  },
  {
    label: "anonymous: mcp needs a bearer",
    method: "POST",
    path: () => "/mcp",
    as: null,
    status: 401,
    error: "Bearer",
  },

  // Non-member: groups don't leak (404, never 403).
  {
    label: "eve: group read",
    method: "GET",
    path: () => `/api/groups/${gid}`,
    as: EVE,
    status: 404,
    error: "Group not found",
  },
  {
    label: "eve: group rename",
    method: "PATCH",
    path: () => `/api/groups/${gid}`,
    as: EVE,
    body: { name: "X" },
    status: 404,
    error: "Group not found",
  },
  {
    label: "eve: group delete",
    method: "DELETE",
    path: () => `/api/groups/${gid}`,
    as: EVE,
    status: 404,
  },
  {
    label: "eve: add member",
    method: "POST",
    path: () => `/api/groups/${gid}/members`,
    as: EVE,
    body: { name: "X" },
    status: 404,
  },
  {
    label: "eve: expenses",
    method: "GET",
    path: () => `/api/groups/${gid}/expenses`,
    as: EVE,
    status: 404,
  },
  {
    label: "eve: balances",
    method: "GET",
    path: () => `/api/groups/${gid}/balances`,
    as: EVE,
    status: 404,
  },
  {
    label: "eve: activity",
    method: "GET",
    path: () => `/api/groups/${gid}/activity`,
    as: EVE,
    status: 404,
  },
  {
    label: "eve: recurring",
    method: "GET",
    path: () => `/api/groups/${gid}/recurring`,
    as: EVE,
    status: 404,
  },
  {
    label: "eve: expense detail",
    method: "GET",
    path: () => `/api/expenses/${expenseId}`,
    as: EVE,
    status: 404,
    error: "Group not found",
  },
  {
    label: "eve: expense edit",
    method: "PUT",
    path: () => `/api/expenses/${expenseId}`,
    as: EVE,
    status: 404,
  },
  {
    label: "eve: person drill-down",
    method: "GET",
    path: () => `/api/balances/${benMember}`,
    as: EVE,
    status: 404,
    error: "Person not found",
  },
  {
    label: "eve: recurring edit",
    method: "PATCH",
    path: () => `/api/recurring/${recurringId}`,
    as: EVE,
    body: { title: "X" },
    status: 404,
  },
  {
    label: "eve: unlinked attachment",
    method: "GET",
    path: () => `/api/attachments/${attachmentId}`,
    as: EVE,
    status: 404,
  },
  {
    label: "eve: venmo avatar",
    method: "GET",
    path: () => "/api/users/1/venmo-avatar",
    as: EVE,
    status: 404,
  },

  // Member, not creator: creator-only gates 403 with their messages.
  {
    label: "ben: rename group",
    method: "PATCH",
    path: () => `/api/groups/${gid}`,
    as: BEN,
    body: { name: "X" },
    status: 403,
    error: "Only the person who created the group can rename it",
  },
  {
    label: "ben: delete group",
    method: "DELETE",
    path: () => `/api/groups/${gid}`,
    as: BEN,
    status: 403,
    error: "can delete it",
  },
  {
    label: "ben: rename placeholder",
    method: "PATCH",
    path: () => `/api/groups/${gid}/members/${zedMember}`,
    as: BEN,
    body: { name: "X" },
    status: 403,
    error: "people who haven't joined yet",
  },
  {
    label: "ben: remove placeholder",
    method: "DELETE",
    path: () => `/api/groups/${gid}/members/${zedMember}`,
    as: BEN,
    status: 403,
    error: "can remove people",
  },
  {
    label: "ben: edit someone else's expense",
    method: "PUT",
    path: () => `/api/expenses/${expenseId}`,
    as: BEN,
    status: 403,
    error: "Only the person who",
  },
  {
    label: "ben: delete someone else's expense",
    method: "DELETE",
    path: () => `/api/expenses/${expenseId}`,
    as: BEN,
    status: 403,
    error: "Only the person who",
  },
  {
    label: "ben: attach to someone else's expense",
    method: "POST",
    path: () => `/api/expenses/${expenseId}/attachments`,
    as: BEN,
    form: () => pdfForm(),
    status: 403,
    error: "can attach files",
  },
  {
    label: "dee: delete a payment she's not in",
    method: "DELETE",
    path: () => `/api/payments/${paymentId}`,
    as: DEE,
    status: 403,
    error: "recorded this payment or someone in it",
  },
  {
    label: "ben: edit recurring he didn't add",
    method: "PATCH",
    path: () => `/api/recurring/${recurringId}`,
    as: BEN,
    body: { title: "X" },
    status: 403,
    error: "recurring bill or the group's creator",
  },
  {
    label: "ben: delete recurring he didn't add",
    method: "DELETE",
    path: () => `/api/recurring/${recurringId}`,
    as: BEN,
    status: 403,
    error: "recurring bill or the group's creator",
  },
  {
    label: "ben: revoke ana's token",
    method: "DELETE",
    path: () => `/api/tokens/${tokenId}`,
    as: BEN,
    status: 404,
    error: "Token not found",
  },
  {
    label: "ben: make ana's email primary",
    method: "PATCH",
    path: () => `/api/me/emails/${anaEmailId}`,
    as: BEN,
    body: { primary: true },
    status: 404,
    error: "Email not found",
  },

  // Members keep their rights…
  {
    label: "ben: read the group",
    method: "GET",
    path: () => `/api/groups/${gid}`,
    as: BEN,
    status: 200,
  },
  {
    label: "ben: list attachments on ana's expense",
    method: "GET",
    path: () => `/api/expenses/${expenseId}/attachments`,
    as: BEN,
    status: 200,
  },
  {
    label: "dee: drill into a groupmate",
    method: "GET",
    path: () => `/api/balances/${benMember}?groupId=${gid}`,
    as: DEE,
    status: 200,
  },
  {
    label: "ben: bill a recurring (any member may, like creating expenses)",
    method: "POST",
    path: () => `/api/recurring/${recurringId}/bill`,
    as: BEN,
    ok: true,
  },
  {
    label: "ben: toggle simplify",
    method: "PATCH",
    path: () => `/api/groups/${gid}`,
    as: BEN,
    body: { simplify: true },
    ok: true,
  },

  // …and the creator keeps theirs.
  {
    label: "ana: rename the group",
    method: "PATCH",
    path: () => `/api/groups/${gid}`,
    as: ANA,
    body: { name: "Flat 2" },
    ok: true,
  },
  {
    label: "ana: rename the placeholder",
    method: "PATCH",
    path: () => `/api/groups/${gid}/members/${zedMember}`,
    as: ANA,
    body: { name: "Zed 2" },
    ok: true,
  },
  {
    label: "ana: remove the placeholder",
    method: "DELETE",
    path: () => `/api/groups/${gid}/members/${zedMember}`,
    as: ANA,
    ok: true,
  },

  // The open endpoints stay open.
  {
    label: "anyone: healthz",
    method: "GET",
    path: () => "/healthz",
    status: 200,
  },
];

for (const row of rows) {
  it(row.label, async () => {
    const res = await call(row.method, row.path(), {
      as: row.as,
      body: row.body,
      form: row.form?.(),
    });
    if (row.ok) expect(res.status).toBeLessThan(300);
    else expect(res.status).toBe(row.status);
    if (row.error) expect(String(res.body?.error ?? "")).toContain(row.error);
  });
}
