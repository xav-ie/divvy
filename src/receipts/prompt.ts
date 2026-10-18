/** What the vision model must return for a receipt; dollars as plain numbers. */
export const RECEIPT_SCHEMA = {
  type: "object",
  properties: {
    merchant: { type: "string" },
    date: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          unitPrice: { type: "number" },
          totalPrice: { type: "number" },
        },
        required: ["name", "quantity", "unitPrice", "totalPrice"],
      },
    },
    subtotal: { type: "number" },
    tax: { type: "number" },
    tip: { type: "number" },
    discount: { type: "number" },
    total: { type: "number" },
  },
  required: [
    "merchant",
    "date",
    "items",
    "subtotal",
    "tax",
    "tip",
    "discount",
    "total",
  ],
} as const;

export const RECEIPT_PROMPT = `You read a photo of one receipt and return its contents as JSON matching the given schema.

Rules:
- "merchant" is the store or restaurant name as printed.
- "date" is the purchase date as YYYY-MM-DD (four digit year, then month, then day). Use "" if the receipt has no date. Never include a time.
- One entry in "items" per line on the receipt. "totalPrice" is what that line costs before tax. "quantity" is 1 unless the receipt shows a count or weight; "unitPrice" is totalPrice divided by quantity.
- Fold discounts and coupons into the item they apply to, so no price is negative. A discount not tied to one item is spread over all items in proportion to their price, so the items add up to the subtotal.
- "subtotal" is the sum of the items after those discounts.
- "tax" is the total tax printed on the receipt. Do not assume a tax rate; copy what is printed, or use 0 if none is shown.
- "tip" is any tip, gratuity, service charge, delivery or other fee, or 0.
- "discount" is any discount printed after the subtotal that you did not already fold into the items, or 0. Never count a discount twice.
- "total" is copied from the receipt. If it isn't printed, use subtotal + tax + tip - discount.
- All money values are plain numbers in the receipt's currency, no symbols or thousands separators.
- Never guess. If a field is unreadable, use "" for text and 0 for numbers.`;
