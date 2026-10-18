import { expect, hydrated, seedGroup, test } from "./fixtures.ts";

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test("scanning a receipt fills the items, tax and tip", async ({ as }) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const page = await ana.page();
  await page.route("**/api/config", (r) => r.fulfill({ json: { scan: true } }));
  await page.route("**/api/receipts/scan", async (r) => {
    expect(r.request().method()).toBe("POST");
    expect(r.request().headers()["content-type"]).toContain(
      "multipart/form-data",
    );
    await new Promise((done) => setTimeout(done, 500));
    await r.fulfill({
      json: {
        receiptId: 42,
        merchant: "Corner Bistro",
        date: "2026-10-09",
        items: [
          { name: "Burger", quantity: 2, unitCents: 1250 },
          { name: "Fries", quantity: 1, unitCents: 500 },
        ],
        taxCents: 240,
        tipCents: 600,
        discountCents: 100,
        totalCents: 3740,
      },
    });
  });

  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  await page
    .getByLabel("Scan receipt")
    .setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
  await expect(
    page.getByText("Reading the receipt, this can take up to a minute…"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Filled 2 items from the receipt ($37.40). Check who had what.",
    ),
  ).toBeVisible();

  await expect(page.getByLabel("Title")).toHaveValue("Corner Bistro");
  await expect(page.getByLabel("Date")).toHaveValue("2026-10-09");
  const first = page.getByRole("group", { name: "Item 1" });
  await expect(first.getByLabel("Item 1", { exact: true })).toHaveValue(
    "Burger",
  );
  await expect(first.getByLabel("Qty")).toHaveValue("2");
  await expect(first.getByLabel("Price each")).toHaveValue("12.50");
  await expect(
    page
      .getByRole("group", { name: "Item 2" })
      .getByLabel("Item 2", { exact: true }),
  ).toHaveValue("Fries");
  await expect(page.getByLabel("Tax", { exact: true })).toHaveValue("2.40");
  await expect(page.getByLabel("Tip", { exact: true })).toHaveValue("6.00");
  await expect(page.getByLabel("Discount", { exact: true })).toHaveValue(
    "1.00",
  );
  await expect(page.getByTestId("total")).toHaveText("$37.40");

  // Fries were only Ben's.
  await page
    .getByRole("group", { name: "Item 2" })
    .getByRole("button", { name: "You", exact: true })
    .click();

  const posted = page.waitForRequest(
    (r) =>
      r.url().endsWith(`/api/groups/${groupId}/expenses`) &&
      r.method() === "POST",
  );
  // The fake receipt id doesn't exist on the server, so drop it before saving for real.
  await page.route(`**/api/groups/${groupId}/expenses`, async (r) => {
    const body = r.request().postDataJSON();
    expect(body.receiptId).toBe(42);
    delete body.receiptId;
    await r.continue({ postData: JSON.stringify(body) });
  });
  await page.getByRole("button", { name: "Save" }).click();
  await posted;
  await expect(page.getByRole("status")).toHaveText("Added Corner Bistro");
});

test("a failed scan shows the server's error", async ({ as }) => {
  const ana = await as("Ana");
  const groupId = await seedGroup(ana, []);
  const page = await ana.page();
  await page.route("**/api/config", (r) => r.fulfill({ json: { scan: true } }));
  await page.route("**/api/receipts/scan", (r) =>
    r.fulfill({
      status: 502,
      json: { error: "Couldn't read that receipt; try a sharper photo" },
    }),
  );
  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  await page
    .getByLabel("Scan receipt")
    .setInputFiles({ name: "r.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("alert")).toHaveText(
    "Couldn't read that receipt; try a sharper photo",
  );
});

test("no scan button when scanning isn't configured", async ({ as }) => {
  const ana = await as("Ana");
  const groupId = await seedGroup(ana, []);
  const page = await ana.page();
  await page.route("**/api/config", (r) =>
    r.fulfill({ json: { scan: false } }),
  );
  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  await expect(page.getByRole("switch", { name: "Itemize" })).toBeVisible();
  await expect(page.getByLabel("Scan receipt")).toHaveCount(0);
});

test("a receipt without a date keeps the form's date", async ({ as }) => {
  const ana = await as("Ana");
  const groupId = await seedGroup(ana, []);
  const page = await ana.page();
  await page.route("**/api/config", (r) => r.fulfill({ json: { scan: true } }));
  await page.route("**/api/receipts/scan", (r) =>
    r.fulfill({
      json: {
        receiptId: 7,
        merchant: "Kiosk",
        date: "",
        items: [{ name: "Gum", quantity: 1, unitCents: 150 }],
        taxCents: 0,
        tipCents: 0,
        discountCents: 0,
        totalCents: 150,
      },
    }),
  );
  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  await page.getByLabel("Date").fill("2026-09-30");
  await page
    .getByLabel("Scan receipt")
    .setInputFiles({ name: "r.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByLabel("Title")).toHaveValue("Kiosk");
  await expect(page.getByLabel("Date")).toHaveValue("2026-09-30");
});
