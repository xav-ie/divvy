import { beforeAll, describe, expect, it } from "vitest";
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

const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
const form = (bytes: Uint8Array, name: string, label?: string) => {
  const f = new FormData();
  f.set("file", new File([new Uint8Array(bytes)], name));
  if (label) f.set("label", label);
  return f;
};

describe("attachments api", () => {
  it("uploads, serves with safe headers, links on create, and guards access", async () => {
    const g = (await call("POST", "/api/groups", { body: { name: "House" } }))
      .body;
    const me = (await call("GET", "/api/me")).body;

    // Upload before saving, then link on create.
    const up = await call("POST", "/api/attachments", {
      form: form(PDF, "bill.pdf", "Statement"),
    });
    expect(up.status).toBe(200);
    const e = await call("POST", `/api/groups/${g.id}/expenses`, {
      body: {
        ...simpleExpense("Electric", 9000, me.memberId, [me.memberId]),
        attachmentIds: [up.body.id],
      },
    });
    expect(e.status).toBe(200);
    const list = await call("GET", `/api/expenses/${e.body.id}/attachments`);
    expect(list.body).toMatchObject([
      { id: up.body.id, label: "Statement", filename: "bill.pdf" },
    ]);

    const file = await call("GET", `/api/attachments/${up.body.id}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("content-disposition")).toBe(
      `inline; filename="bill.pdf"; filename*=UTF-8''bill.pdf`,
    );
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("content-security-policy")).toBe("sandbox");
    const dl = await call("GET", `/api/attachments/${up.body.id}?download=1`);
    expect(dl.headers.get("content-disposition")).toBe(
      `attachment; filename="bill.pdf"; filename*=UTF-8''bill.pdf`,
    );
    expect(dl.headers.get("x-content-type-options")).toBe("nosniff");

    const png = await call("POST", `/api/expenses/${e.body.id}/attachments`, {
      form: form(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
        "meter.png",
      ),
    });
    const img = await call("GET", `/api/attachments/${png.body.id}`);
    expect(img.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'",
    );

    const html = await call("POST", `/api/expenses/${e.body.id}/attachments`, {
      form: form(
        new TextEncoder().encode("<html><script>alert(1)</script>"),
        "invoice.pdf",
      ),
    });
    expect(html.status).toBe(400);
    expect(
      (
        await call("GET", `/api/attachments/${up.body.id}`, {
          as: "eve@example.com",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("DELETE", `/api/attachments/${up.body.id}`, {
          as: "eve@example.com",
        })
      ).status,
    ).toBe(404);
    expect(
      (await call("DELETE", `/api/attachments/${up.body.id}`)).status,
    ).toBe(204);
  });
});
