import { describe, expect, it } from "vitest";
import { SCAN_MODEL, ScanError, scanReceipt } from "../../src/receipts/scan.ts";
import { fakeAi, PNG } from "./fake-ai.ts";

describe("scanReceipt", () => {
  it("sends the photo with the schema and parses the answer into cents", async () => {
    const calls = fakeAi({
      merchant: " Walmart ",
      date: "2026-02-30",
      items: [
        { name: "Bananas", quantity: 2.37, unitPrice: 0.58, totalPrice: 1.39 },
        { name: "Milk", quantity: 2, unitPrice: 1.87, totalPrice: 3.74 },
        { name: "", quantity: 0, unitPrice: 0, totalPrice: 0 },
      ],
      subtotal: 5.13,
      tax: 0.12,
      tip: 0,
      discount: 0.5,
      total: 4.73,
    });
    expect(await scanReceipt(PNG, "image/png")).toEqual({
      merchant: "Walmart",
      date: "",
      items: [
        { name: "Bananas", quantity: 1, unitCents: 139 },
        { name: "Milk", quantity: 2, unitCents: 187 },
        { name: "Item 3", quantity: 1, unitCents: 0 },
      ],
      subtotalCents: 513,
      taxCents: 12,
      tipCents: 0,
      discountCents: 50,
      totalCents: 473,
    });

    expect(calls).toHaveLength(1);
    const { model, inputs } = calls[0]!;
    expect(model).toBe(SCAN_MODEL);
    expect(inputs.response_format.json_schema.required).toContain("items");
    expect(inputs.messages[1].content[0].image_url.url).toBe(
      `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`,
    );
  });

  it("reads JSON wrapped in text and keeps a real date", async () => {
    fakeAi(
      'Here it is: {"merchant":"","date":"2026-01-31","items":[],"subtotal":0,"tax":0,"tip":0,"discount":0,"total":0}',
    );
    expect((await scanReceipt(PNG, "image/png")).date).toBe("2026-01-31");
  });

  it("turns model errors and unreadable answers into ScanErrors", async () => {
    fakeAi(new Error("3040: Capacity temporarily exceeded"));
    await expect(scanReceipt(PNG, "image/png")).rejects.toThrow(
      new ScanError(
        "Couldn't read the receipt (3040: Capacity temporarily exceeded). Try a clearer photo or enter the items by hand.",
      ),
    );
    fakeAi("I can't read this image.");
    await expect(scanReceipt(PNG, "image/png")).rejects.toThrow(
      /Couldn't read the receipt \(I can't read this image\.\)/,
    );
    fakeAi({ merchant: "no items" });
    await expect(scanReceipt(PNG, "image/png")).rejects.toThrow(
      /unexpected answer/,
    );
  });
});
