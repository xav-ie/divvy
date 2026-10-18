import { beforeAll, describe, expect, it } from "vitest";
import { apiClient } from "./client.ts";

let call: Awaited<ReturnType<typeof apiClient>>;
beforeAll(async () => {
  call = await apiClient(["ana@example.com", "ben@example.com"]);
});

describe("recurring api", () => {
  it("creates, lists, bills, edits and deletes templates", async () => {
    const group = (
      await call("POST", "/api/groups", { body: { name: "Flat" } })
    ).body;
    const ben = (
      await call("POST", `/api/groups/${group.id}/members`, {
        body: { email: "ben@example.com" },
      })
    ).body;
    const me = (await call("GET", "/api/me")).body;
    const a = me.memberId;
    const missing = await call("POST", `/api/groups/${group.id}/recurring`, {
      body: {
        title: "Power",
        dayOfMonth: 1,
        split: { [a]: 1 },
        payerMemberId: a,
      },
    });
    expect(missing.body).toEqual({
      error: "amountCents: Enter the monthly amount",
    });

    // Including this month bills it right away, for the fixed amount.
    const created = await call("POST", `/api/groups/${group.id}/recurring`, {
      body: {
        title: "Internet",
        dayOfMonth: 1,
        amountCents: 4200,
        split: { [a]: 1, [ben.id]: 1 },
        payerMemberId: a,
        billThisMonth: true,
      },
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      title: "Internet",
      amountCents: 4200,
      status: "billed",
      canBillNow: false,
      paused: false,
    });
    const first = created.body.expenseId;
    expect((await call("GET", `/api/expenses/${first}`)).body.totalCents).toBe(
      4200,
    );

    const list = await call("GET", `/api/groups/${group.id}/recurring`);
    expect(list.body.map((t: { id: number }) => t.id)).toEqual([
      created.body.id,
    ]);
    expect(
      (
        await call("POST", `/api/recurring/${created.body.id}/bill`, {
          body: {},
        })
      ).status,
    ).toBe(400);

    // A deleted month's bill can be added again by hand; any amount sent is ignored.
    expect((await call("DELETE", `/api/expenses/${first}`)).status).toBe(204);
    const billed = await call(
      "POST",
      `/api/recurring/${created.body.id}/bill`,
      { as: "ben@example.com", body: { amountCents: 1 } },
    );
    expect(billed.status).toBe(200);
    const expense = (
      await call("GET", `/api/expenses/${billed.body.expenseId}`)
    ).body;
    expect(expense.recurringId).toBe(created.body.id);
    expect(expense.totalCents).toBe(4200);

    const patched = await call("PATCH", `/api/recurring/${created.body.id}`, {
      body: { paused: true },
    });
    expect(patched.body).toMatchObject({ paused: true, status: "billed" });
    expect(
      (
        await call("DELETE", `/api/recurring/${created.body.id}`, {
          as: "ben@example.com",
        })
      ).status,
    ).toBe(403);
    expect(
      (await call("DELETE", `/api/recurring/${created.body.id}`)).status,
    ).toBe(204);
  });
});
