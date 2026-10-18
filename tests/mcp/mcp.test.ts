import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiClient } from "../api/client.ts";
import { fakeAi, PNG, RECEIPT } from "../receipts/fake-ai.ts";

const ANA = "ana@example.com";
const BEN = "ben@example.com";
let api: Awaited<ReturnType<typeof apiClient>>;
let client: Client;

beforeAll(async () => {
  api = await apiClient([ANA, BEN]);
  await api("GET", "/api/me", { as: ANA });
  await api("GET", "/api/me", { as: BEN });
  const house = (await api("POST", "/api/groups", { body: { name: "House" } }))
    .body;
  for (const body of [{ email: BEN }, { name: "Cy" }, { name: "Cyrus" }])
    await api("POST", `/api/groups/${house.id}/members`, { body });
  await api("POST", "/api/groups", { as: BEN, body: { name: "Ben's" } });
  const { token } = (
    await api("POST", "/api/tokens", { body: { name: "Claude" } })
  ).body;

  client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://divvy.test/mcp"), {
      fetch: api.fetch,
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
});
afterAll(() => client?.close());

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError)
    return { error: (r.content as Array<{ text: string }>)[0]!.text };
  return r.structuredContent as any;
}

describe("divvy mcp", () => {
  it("lists every tool", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_expense",
      "add_placeholder",
      "add_recurring",
      "attach_document",
      "balances",
      "bill_recurring",
      "delete_expense",
      "get_expense",
      "list_attachments",
      "list_expenses",
      "list_groups",
      "list_members",
      "list_recurring",
      "record_payment",
      "remove_attachment",
      "rename_member",
      "restore_expense",
      "set_venmo_username",
    ]);
    expect(tools.find((t) => t.name === "add_expense")!.description).toMatch(
      /dry_run: true first/,
    );
  });

  it("sees only the acting user's groups", async () => {
    const { groups } = await call("list_groups");
    expect(groups.map((g: { name: string }) => g.name)).toEqual(["House"]);
    expect(await call("list_members", { group: "Ben's" })).toEqual({
      error: 'No group called "Ben\'s". Choices: House (id 1)',
    });
  });

  it("previews, then saves, a simple expense by name", async () => {
    const args = {
      group: "house",
      title: "Pizza",
      date: "2026-03-01",
      amount_cents: 3000,
      split_among: ["me", "Ben"],
      dry_run: true,
    };
    const preview = await call("add_expense", args);
    expect(preview).toMatchObject({
      saved: false,
      total: "$30.00",
      shares: [
        { name: "Ana", cents: 1500 },
        { name: "Ben", cents: 1500 },
      ],
      paidBy: [{ name: "Ana", cents: 3000 }],
    });
    expect(preview.balances).toContainEqual(
      expect.objectContaining({
        name: "Ben",
        effectCents: -1500,
        after: "Ben owes $15.00 in total",
      }),
    );
    expect((await call("list_expenses", { group: "House" })).expenses).toEqual(
      [],
    );

    const saved = await call("add_expense", { ...args, dry_run: false });
    expect(saved.saved).toBe(true);
    const got = await call("get_expense", { expense_id: saved.expense.id });
    expect(got.expense.items[0]).toMatchObject({
      name: "Pizza",
      splitType: "equal",
      split: { Ana: 1, Ben: 1 },
    });
    expect((await call("balances", { person: "Ben" })).drillDown.sentence).toBe(
      "Ben owes you $15.00",
    );
  });

  it("explains ambiguous and unknown names", async () => {
    const base = {
      group: "House",
      title: "x",
      amount_cents: 100,
      dry_run: true,
    };
    // An exact name wins over a longer one sharing its prefix.
    const exact = await call("add_expense", { ...base, split_among: ["cy"] });
    expect(exact.shares).toEqual([expect.objectContaining({ name: "Cy" })]);
    const ambiguous = await call("add_expense", {
      ...base,
      split_among: ["c"],
    });
    expect(ambiguous.error).toMatch(
      /"c" could be Cy \(id \d+\), Cyrus \(id \d+\)/,
    );
    const unknown = await call("add_expense", { ...base, paid_by: "Zed" });
    expect(unknown.error).toMatch(/^No member called "Zed"\. Choices: /);
  });

  it("takes tax as a percent", async () => {
    const r = await call("add_expense", {
      group: "House",
      title: "Lunch",
      amount_cents: 3000,
      tax_percent: 10,
      dry_run: true,
    });
    expect(r).toMatchObject({ total: "$33.00", paidBy: [{ cents: 3300 }] });
  });

  it("adds itemized expenses with payers, payments and balances", async () => {
    const r = await call("add_expense", {
      group: "House",
      title: "Groceries",
      date: "2026-03-02",
      items: [
        { name: "Wine", unit_cents: 1000, split_among: ["Ben"] },
        {
          name: "Bread",
          quantity: 2,
          unit_cents: 250,
          split: { Ana: 1, Ben: 3 },
        },
      ],
      tax_cents: 150,
      payers: { Ben: 1650 },
      dry_run: false,
    });
    expect(r.expense.shares).toEqual([
      expect.objectContaining({ name: "Ana", cents: 138 }),
      expect.objectContaining({ name: "Ben", cents: 1512 }),
    ]);
    const pay = await call("record_payment", {
      group: "House",
      from: "Ben",
      to: "me",
      amount_cents: 500,
      date: "2026-03-03",
    });
    expect(pay.payment.sentence).toBe("Ben paid Ana $5.00");
    const overall = (await call("balances")).overall;
    expect(overall.sentence).toBe("Overall, you're owed $8.62");
    const group = (await call("balances", { group: "House" })).group;
    expect(group.pairs[0].sentence).toBe("Ben owes you $8.62");
  });

  it("refuses a Venmo username it can't confirm", async () => {
    // Lookups are off in tests, so Venmo can't confirm anything (the found and
    // not-found paths are covered over HTTP with the stub in http.test.ts).
    expect(await call("set_venmo_username", { username: "@ana-pays" })).toEqual(
      {
        error: "Couldn't check Venmo right now; try again in a minute.",
      },
    );
    expect((await call("set_venmo_username", { username: "x" })).error).toMatch(
      /Venmo usernames are 5 to 30/,
    );
    expect(await call("set_venmo_username", { username: null })).toEqual({
      venmo: null,
    });
  });

  it("attaches a document sent as base64", async () => {
    const saved = await call("add_expense", {
      group: "House",
      title: "Electric",
      date: "2026-03-05",
      amount_cents: 9000,
      dry_run: false,
    });
    const pdf = Buffer.from("%PDF-1.7\n%%EOF\n").toString("base64");
    const r = await call("attach_document", {
      expense_id: saved.expense.id,
      filename: "eversource.pdf",
      content_base64: pdf,
      label: "Eversource statement",
    });
    expect(r.attachment).toMatchObject({
      mime: "application/pdf",
      label: "Eversource statement",
      url: `/api/attachments/${r.attachment.id}`,
    });
    const html = Buffer.from("<html></html>").toString("base64");
    expect(
      (
        await call("attach_document", {
          expense_id: saved.expense.id,
          filename: "x.pdf",
          content_base64: html,
        })
      ).error,
    ).toMatch(/^Attach a PDF or a photo/);
    expect(
      (
        await call("list_attachments", { expense_id: saved.expense.id })
      ).attachments.map((a: { filename: string }) => a.filename),
    ).toEqual(["eversource.pdf"]);
    expect(
      await call("remove_attachment", { attachment_id: r.attachment.id }),
    ).toEqual({
      removed: r.attachment.id,
    });
  });

  it("renames a placeholder", async () => {
    const r = await call("rename_member", {
      group: "House",
      member: "Cyrus",
      name: "Cyrus B",
    });
    expect(r.member).toMatchObject({ name: "Cyrus B", placeholder: true });
    expect(
      (
        await call("rename_member", {
          group: "House",
          member: "Ben",
          name: "X",
        })
      ).error,
    ).toBe("Ben has an account and picks their own name");
  });

  it("adds a placeholder, recurring bills and bills them", async () => {
    expect(
      (await call("add_placeholder", { group: "House", name: "Dee" })).member,
    ).toMatchObject({
      name: "Dee",
      placeholder: true,
    });
    expect(
      (
        await call("add_recurring", {
          group: "House",
          title: "Power",
          day_of_month: 1,
        })
      ).error ?? "missing",
    ).not.toBe("missing");
    const added = await call("add_recurring", {
      group: "House",
      title: "Internet",
      day_of_month: 1,
      amount_cents: 9000,
      bill_this_month: true,
      split_among: ["me", "Dee"],
    });
    const { recurring } = added;
    expect(recurring).toMatchObject({
      amount: "$90.00",
      paidBy: "Ana",
      weights: { Ana: 1, Dee: 1 },
    });
    // Delete this month's bill, then add it again by hand for the same amount.
    await call("delete_expense", { expense_id: added.billedExpenseId });
    const { expenseId } = await call("bill_recurring", {
      recurring_id: recurring.id,
    });
    expect(
      (await call("get_expense", { expense_id: expenseId })).expense
        .recurringId,
    ).toBe(recurring.id);
    const [listed] = (await call("list_recurring", { group: "House" }))
      .recurring;
    expect(listed.status).toBe("billed");
  });

  it("saves a scanned receipt's items and deletes expenses", async () => {
    fakeAi(RECEIPT);
    const form = new FormData();
    form.set("file", new File([PNG], "r.png"));
    const scan = (await api("POST", "/api/receipts/scan", { form })).body;
    expect(scan).toMatchObject({ merchant: "Corner Shop", totalCents: 864 });
    const saved = await call("add_expense", {
      group: "House",
      title: "Shop",
      items: scan.items.map(
        (it: { name: string; quantity: number; unitCents: number }) => ({
          name: it.name,
          quantity: it.quantity,
          unit_cents: it.unitCents,
        }),
      ),
      tax_cents: scan.taxCents,
      receipt_id: scan.receiptId,
      dry_run: false,
    });
    expect(saved.expense).toMatchObject({
      totalCents: 864,
      receiptId: scan.receiptId,
    });
    expect(
      await call("delete_expense", { expense_id: saved.expense.id }),
    ).toEqual({
      deleted: saved.expense.id,
    });
    expect(
      (await call("restore_expense", { expense_id: saved.expense.id })).expense,
    ).toMatchObject({ id: saved.expense.id, receiptId: scan.receiptId });
  });
});
