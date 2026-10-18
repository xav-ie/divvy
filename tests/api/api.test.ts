import { beforeAll, describe, expect, it } from "vitest";
import { apiClient } from "./client.ts";

const ANA = "ana@example.com";
const BEN = "ben@example.com";
const EVE = "eve@example.com";
let call: Awaited<ReturnType<typeof apiClient>>;

beforeAll(async () => {
  call = await apiClient([ANA, BEN, EVE]);
});

describe("auth", () => {
  it("serves /healthz without a user", async () => {
    expect((await call("GET", "/healthz", { as: null })).status).toBe(200);
  });

  it("rejects unknown users with 401", async () => {
    const res = await call("GET", "/api/me", { as: null });
    expect(res).toEqual({ status: 401, body: { error: "Sign in required" } });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("creates the user on first request", async () => {
    const res = await call("GET", "/api/me", { as: BEN });
    expect(res.body).toMatchObject({ email: BEN, name: "Ben" });
    // The client polls /api/me to notice an expired Access session; it must never be cached.
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("full flow", () => {
  it("creates a group, adds people and expenses, and settles up", async () => {
    const ana = (
      await call("PATCH", "/api/me", { as: ANA, body: { name: "Ana" } })
    ).body;
    const ben = (await call("GET", "/api/me", { as: BEN })).body;

    const group = await call("POST", "/api/groups", {
      as: ANA,
      body: { name: "House", emoji: "🏠" },
    });
    expect(group.status).toBe(200);
    const g = group.body.id;

    expect(
      (
        await call("POST", `/api/groups/${g}/members`, {
          as: ANA,
          body: { email: BEN },
        })
      ).status,
    ).toBe(200);
    const cy = (
      await call("POST", `/api/groups/${g}/members`, {
        as: BEN,
        body: { name: "Cy" },
      })
    ).body;
    expect(cy).toMatchObject({ name: "Cy", placeholder: true });

    const expense = {
      title: "Dinner",
      date: "2026-03-01",
      items: [
        {
          name: "Food",
          unitCents: 9000,
          splitType: "equal",
          split: { [ana.memberId]: 1, [ben.memberId]: 1, [cy.id]: 1 },
        },
      ],
      payers: { [ana.memberId]: 9000 },
      receiptPath: "/etc/passwd",
    };
    const preview = await call("POST", `/api/groups/${g}/expenses?dryRun=1`, {
      as: BEN,
      body: expense,
    });
    expect(preview.body.shares).toEqual({
      [ana.memberId]: 3000,
      [ben.memberId]: 3000,
      [cy.id]: 3000,
    });
    expect(
      (await call("GET", `/api/groups/${g}/expenses`, { as: ANA })).body,
    ).toEqual([]);

    const created = await call("POST", `/api/groups/${g}/expenses`, {
      as: ANA,
      body: expense,
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      totalCents: 9000,
      receiptPath: null,
      canEdit: true,
    });
    const e = created.body.id;

    expect(
      (await call("GET", `/api/expenses/${e}`, { as: BEN })).body.canEdit,
    ).toBe(false);
    expect(
      (await call("DELETE", `/api/expenses/${e}`, { as: BEN })).status,
    ).toBe(403);

    const home = await call("GET", "/api/balances", { as: ANA });
    expect(home.body.sentence).toBe("Overall, you're owed $60.00");

    const pay = await call("POST", `/api/groups/${g}/payments`, {
      as: BEN,
      body: {
        fromMember: ben.memberId,
        toMember: ana.memberId,
        cents: 3000,
        date: "2026-03-02",
      },
    });
    expect(pay.status).toBe(200);

    const balances = await call("GET", `/api/groups/${g}/balances`, {
      as: BEN,
    });
    expect(
      balances.body.pairs.map((p: { sentence: string }) => p.sentence),
    ).toEqual(["Cy owes Ana $30.00"]);

    const drill = await call(
      "GET",
      `/api/balances/${ben.memberId}?groupId=${g}`,
      { as: ANA },
    );
    expect(drill.body.sentence).toBe("You and Ben are settled up");
    expect(drill.body.lines).toHaveLength(2);

    const activity = await call("GET", `/api/groups/${g}/activity`, {
      as: ANA,
    });
    expect(activity.body.map((a: { sentence: string }) => a.sentence)).toEqual([
      "Ben paid you $30.00",
      'You added "Dinner" ($90.00)',
    ]);

    expect(
      (await call("DELETE", `/api/groups/${g}/members/${cy.id}`, { as: ANA }))
        .status,
    ).toBe(409);
    expect(
      (
        await call("PUT", `/api/expenses/${e}`, {
          as: ANA,
          body: { ...expense, title: "Dinner out" },
        })
      ).body.title,
    ).toBe("Dinner out");
    expect(
      (await call("DELETE", `/api/expenses/${e}`, { as: ANA })).status,
    ).toBe(204);
    expect(
      (await call("DELETE", `/api/groups/${g}/members/${cy.id}`, { as: ANA }))
        .status,
    ).toBe(204);
    expect(
      (await call("DELETE", `/api/payments/${pay.body.id}`, { as: BEN }))
        .status,
    ).toBe(204);
  });
});

describe("permissions and validation", () => {
  it("hides groups from non-members and limits admin to the creator", async () => {
    const g = (
      await call("POST", "/api/groups", { as: ANA, body: { name: "Private" } })
    ).body.id;
    await call("POST", `/api/groups/${g}/members`, {
      as: ANA,
      body: { email: BEN },
    });

    for (const [method, path] of [
      ["GET", `/api/groups/${g}`],
      ["GET", `/api/groups/${g}/expenses`],
      ["GET", `/api/groups/${g}/balances`],
      ["GET", `/api/groups/${g}/activity`],
      ["POST", `/api/groups/${g}/members`],
    ] as const) {
      const res = await call(method, path, {
        as: EVE,
        body: method === "POST" ? { name: "Mallory" } : undefined,
      });
      expect(res, `${method} ${path}`).toEqual({
        status: 404,
        body: { error: "Group not found" },
      });
    }
    expect((await call("GET", "/api/groups", { as: EVE })).body).toEqual([]);
    expect(
      (
        await call("PATCH", `/api/groups/${g}`, {
          as: BEN,
          body: { name: "Mine" },
        })
      ).status,
    ).toBe(403);
    expect((await call("DELETE", `/api/groups/${g}`, { as: BEN })).status).toBe(
      403,
    );
    expect((await call("DELETE", `/api/groups/${g}`, { as: ANA })).status).toBe(
      204,
    );
  });

  it("returns readable 400s", async () => {
    const me = (await call("GET", "/api/me", { as: ANA })).body.memberId;
    const g = (
      await call("POST", "/api/groups", { as: ANA, body: { name: "Bad" } })
    ).body.id;
    expect(
      await call("POST", "/api/groups", { as: ANA, body: { name: "" } }),
    ).toEqual({
      status: 400,
      body: { error: "name: Name can't be empty" },
    });
    const res = await call("POST", `/api/groups/${g}/expenses`, {
      as: ANA,
      body: {
        title: "X",
        date: "2026-01-01",
        items: [{ unitCents: 100, splitType: "percent", split: { [me]: 50 } }],
        payers: { [me]: 100 },
      },
    });
    expect(res).toEqual({
      status: 400,
      body: { error: "Item 1 percentages add up to 50%, they must total 100%" },
    });
  });
});
