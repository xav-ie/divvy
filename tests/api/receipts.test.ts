import { beforeAll, describe, expect, it } from "vitest";
import { fakeAi, PNG, RECEIPT } from "../receipts/fake-ai.ts";
import { simpleExpense } from "../helpers.ts";
import { apiClient } from "./client.ts";

let call: Awaited<ReturnType<typeof apiClient>>;
beforeAll(async () => {
  call = await apiClient([
    "ana@example.com",
    "ben@example.com",
    "eve@example.com",
  ]);
});

const upload = (bytes: Uint8Array<ArrayBuffer>, name = "r.png") => {
  const form = new FormData();
  form.set("file", new File([bytes], name));
  return form;
};

describe("receipts api", () => {
  it("reports whether scanning is configured", async () => {
    fakeAi();
    expect((await call("GET", "/api/config")).body).toMatchObject({
      scan: false,
    });
    expect(
      (await call("POST", "/api/receipts/scan", { form: upload(PNG) })).status,
    ).toBe(503);
    fakeAi(RECEIPT);
    expect((await call("GET", "/api/config")).body).toMatchObject({
      scan: true,
    });
  });

  it("rejects non-images and reports scan failures", async () => {
    fakeAi(RECEIPT);
    const text = await call("POST", "/api/receipts/scan", {
      form: upload(new TextEncoder().encode("hello"), "r.txt"),
    });
    expect(text.status).toBe(400);
    fakeAi(new Error("overloaded"));
    const failed = await call("POST", "/api/receipts/scan", {
      form: upload(PNG),
    });
    expect(failed).toMatchObject({
      status: 502,
      body: { error: expect.stringContaining("overloaded") },
    });
  });

  it("scans, links the receipt to an expense, and shows it to the group only", async () => {
    fakeAi(RECEIPT);
    const scanned = await call("POST", "/api/receipts/scan", {
      form: upload(PNG),
    });
    expect(scanned.status).toBe(200);
    expect(scanned.body).toMatchObject({
      merchant: "Corner Shop",
      date: "2026-03-04",
      items: [
        { name: "Bread", quantity: 1, unitCents: 350 },
        { name: "Eggs", quantity: 2, unitCents: 225 },
      ],
      taxCents: 64,
      tipCents: 0,
      discountCents: 0,
      totalCents: 864,
    });
    const { receiptId } = scanned.body;

    // Before linking only the uploader sees it.
    expect((await call("GET", `/api/receipts/${receiptId}`)).status).toBe(200);
    expect(
      (
        await call("GET", `/api/receipts/${receiptId}`, {
          as: "ben@example.com",
        })
      ).status,
    ).toBe(404);

    const group = (
      await call("POST", "/api/groups", { body: { name: "Shop" } })
    ).body;
    await call("POST", `/api/groups/${group.id}/members`, {
      body: { email: "ben@example.com" },
    });
    const me = (await call("GET", "/api/me")).body;
    const expense = await call("POST", `/api/groups/${group.id}/expenses`, {
      body: {
        ...simpleExpense("Shop", 864, me.memberId, [me.memberId]),
        receiptId,
      },
    });
    expect(expense.status).toBe(200);
    expect(expense.body.receiptId).toBe(receiptId);

    expect(
      (
        await call("GET", `/api/receipts/${receiptId}`, {
          as: "ben@example.com",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("GET", `/api/receipts/${receiptId}`, {
          as: "eve@example.com",
        })
      ).status,
    ).toBe(404);

    // Eve can't attach Ana's receipt to her own group's expense.
    const eveGroup = (
      await call("POST", "/api/groups", {
        as: "eve@example.com",
        body: { name: "Eve" },
      })
    ).body;
    const eve = (await call("GET", "/api/me", { as: "eve@example.com" })).body;
    const stolen = await call("POST", `/api/groups/${eveGroup.id}/expenses`, {
      as: "eve@example.com",
      body: {
        ...simpleExpense("x", 100, eve.memberId, [eve.memberId]),
        receiptId,
      },
    });
    expect(stolen.status).toBe(404);

    // Ana can't attach Ben's unlinked upload, nor move her linked receipt to another group.
    const bens = await call("POST", "/api/receipts/scan", {
      as: "ben@example.com",
      form: upload(PNG),
    });
    const borrowed = await call("POST", `/api/groups/${group.id}/expenses`, {
      body: {
        ...simpleExpense("Shop", 864, me.memberId, [me.memberId]),
        receiptId: bens.body.receiptId,
      },
    });
    expect(borrowed.status).toBe(404);
    const other = (
      await call("POST", "/api/groups", { body: { name: "Other" } })
    ).body;
    const moved = await call("POST", `/api/groups/${other.id}/expenses`, {
      body: {
        ...simpleExpense("Shop", 864, me.memberId, [me.memberId]),
        receiptId,
      },
    });
    expect(moved.status).toBe(404);

    // Omitting receiptId on update keeps it; null removes it.
    const body = simpleExpense("Shop", 864, me.memberId, [me.memberId]);
    const kept = await call("PUT", `/api/expenses/${expense.body.id}`, {
      body,
    });
    expect(kept.body.receiptId).toBe(receiptId);
    const removed = await call("PUT", `/api/expenses/${expense.body.id}`, {
      body: { ...body, receiptId: null },
    });
    expect(removed.body.receiptId).toBe(null);
  });

  it("keeps a shared photo, then reads it for whoever shared it", async () => {
    fakeAi();
    const form = new FormData();
    form.set("receipt", new File([PNG], "shared.png"));
    const shared = await call("POST", "/share", { form });
    expect(shared.status).toBe(303);
    const to = shared.headers.get("location")!;
    expect(to).toMatch(/^\/expenses\/new\?receipt=\d+$/);
    const receiptId = Number(
      new URL(to, "http://x").searchParams.get("receipt"),
    );
    // Kept even while scanning is off, so the photo still attaches.
    expect((await call("GET", `/api/receipts/${receiptId}`)).status).toBe(200);
    expect((await call("POST", `/api/receipts/${receiptId}/scan`)).status).toBe(
      503,
    );

    fakeAi(RECEIPT);
    const scanned = await call("POST", `/api/receipts/${receiptId}/scan`);
    expect(scanned.status).toBe(200);
    expect(scanned.body).toMatchObject({ receiptId, merchant: "Corner Shop" });
    expect(
      (
        await call("POST", `/api/receipts/${receiptId}/scan`, {
          as: "ben@example.com",
        })
      ).status,
    ).toBe(404);

    const bad = new FormData();
    bad.set("receipt", new File([new TextEncoder().encode("hi")], "a.txt"));
    const rejected = await call("POST", "/share", { form: bad });
    expect(rejected.status).toBe(303);
    expect(rejected.headers.get("location")).toBe(
      `/expenses/new?error=${encodeURIComponent("Upload a JPEG, PNG, WebP or GIF photo")}`,
    );
  });
});
