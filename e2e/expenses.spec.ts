import type { Locator, Page } from "@playwright/test";
import { expect, hydrated, seedExpense, seedGroup, test } from "./fixtures.ts";

const CHIPS = ["You", "Ben", "Cy", "Dee"];

/** Fill item `n` (1-based) and pick exactly who shares it. */
async function fillItem(
  page: Page,
  n: number,
  name: string,
  price: string,
  who: string[],
) {
  const item = page.getByRole("group", { name: `Item ${n}` });
  await item.getByLabel(`Item ${n}`, { exact: true }).fill(name);
  await item.getByLabel("Price each").fill(price);
  for (const chip of CHIPS) {
    const button = item.getByRole("button", { name: chip, exact: true });
    const pressed = (await button.getAttribute("aria-pressed")) === "true";
    if (pressed !== who.includes(chip)) await button.click();
  }
}

const share = (summary: Locator, who: string) =>
  summary
    .getByRole("listitem")
    .filter({ hasText: who === "You" ? "Your share" : `${who}'s share` });

test("add a simple expense split equally", async ({ as }) => {
  const ana = await as("Ana");
  const ben = await as("Ben");
  const cy = await as("Cy");
  const groupId = await seedGroup(ana, [ben, cy]);
  const page = await ana.page();

  await page.goto(`/groups/${groupId}`);
  await page.getByRole("link", { name: "Add expense" }).click();
  await hydrated(page);

  // Inline validation before anything is filled in.
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Give the expense a title")).toBeVisible();
  await expect(page.getByText("Enter an amount above $0.00")).toBeVisible();

  await page.getByLabel("Title").fill("Pizza");
  await page.getByLabel("Amount").fill("10");
  const summary = page.getByRole("region", { name: "Summary" });
  // One of the three carries the odd cent; which one depends on the bill.
  await expect(summary.getByRole("listitem")).toHaveCount(3);
  const amounts = await summary
    .getByRole("listitem")
    .locator("span.font-medium")
    .allTextContents();
  expect(amounts.sort()).toEqual(["$3.33", "$3.33", "$3.34"]);
  const mine = (await share(summary, "You")
    .locator("span.font-medium")
    .textContent())!;
  await expect(page.getByTestId("total")).toHaveText("$10.00");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
  await expect(page.getByRole("status")).toHaveText("Added Pizza");
  const row = page.getByRole("link", { name: /Pizza/ });
  await expect(row).toContainText("$10.00");
  await expect(row).toContainText("You paid $10.00");
  // The saved split matches the preview.
  await expect(row).toContainText(`your share ${mine}`);
});

test("itemized dinner with tax and tip splits to 40.96 / 33.28 / 21.76 / 37.12", async ({
  as,
}) => {
  const ana = await as("Ana");
  const [ben, cy, dee] = await Promise.all([as("Ben"), as("Cy"), as("Dee")]);
  const groupId = await seedGroup(ana, [ben, cy, dee]);
  const page = await ana.page();

  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  await page.getByLabel("Title").fill("Dinner");
  await page.getByRole("switch", { name: "Itemize" }).click();

  const items: Array<[string, string, string[]]> = [
    ["Ana main", "18", ["You"]],
    ["Ben main", "16", ["Ben"]],
    ["Cy main", "14", ["Cy"]],
    ["Dee main", "26", ["Dee"]],
    ["Nachos", "12", CHIPS],
    ["Ana drinks", "11", ["You"]],
    ["Ben drinks", "7", ["Ben"]],
  ];
  for (const [i, [name, price, who]] of items.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Add item" }).click();
    await fillItem(page, i + 1, name, price, who);
  }
  // 8% tax as a percentage, the 20% tip typed in dollars.
  await page.getByRole("radio", { name: "Tax in percent" }).click();
  await page.getByLabel("Tax", { exact: true }).fill("8");
  await page.getByLabel("Tip", { exact: true }).fill("20.80");

  const summary = page.getByRole("region", { name: "Summary" });
  await expect(page.getByTestId("total")).toHaveText("$133.12");
  await expect(share(summary, "You")).toContainText("$40.96");
  await expect(share(summary, "Ben")).toContainText("$33.28");
  await expect(share(summary, "Cy")).toContainText("$21.76");
  await expect(share(summary, "Dee")).toContainText("$37.12");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Dinner");

  await page.getByRole("link", { name: /Dinner/ }).click();
  const shares = page.getByRole("list", { name: "Shares" });
  await expect(shares).toContainText("Your share $40.96");
  await expect(shares).toContainText("Ben's share $33.28");
  await expect(shares).toContainText("Cy's share $21.76");
  await expect(shares).toContainText("Dee's share $37.12");
  await expect(page.getByText("Ben owes you $33.28")).toBeVisible();
  await expect(page.getByText("Tax")).toBeVisible();
});

test("several people paid", async ({ as }) => {
  const ana = await as("Ana");
  const ben = await as("Ben");
  const groupId = await seedGroup(ana, [ben]);
  const page = await ana.page();

  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  await page.getByLabel("Title").fill("Groceries");
  await page.getByLabel("Amount").fill("90");
  await page.getByRole("button", { name: "Several people paid" }).click();
  await expect(page.getByLabel("You paid")).toHaveValue("90.00");
  await page.getByLabel("You paid").fill("60");
  await expect(page.getByTestId("remaining")).toHaveText(
    "$30.00 left to assign",
  );

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Paid amounts add up to $60.00 but the total is $90.00",
  );

  await page.getByLabel("Ben paid").fill("30");
  await expect(page.getByTestId("remaining")).toHaveText(
    "Paid amounts match the total.",
  );
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Groceries");
  await page.getByRole("link", { name: /Groceries/ }).click();
  await expect(page.getByText("You paid $60.00")).toBeVisible();
  await expect(page.getByText("Ben paid $30.00")).toBeVisible();
  // Each paid their own $45 share less or more: Ben paid 30 of his 45.
  await expect(page.getByText("Ben owes you $15.00")).toBeVisible();
});

test("only whoever added or paid an expense can change it", async ({ as }) => {
  const ana = await as("Ana");
  const ben = await as("Ben");
  const groupId = await seedGroup(ana, [ben]);
  const id = await seedExpense(ana, groupId, "Internet", 6000, ana, [ana, ben]);

  const benPage = await ben.page();
  await benPage.goto(`/expenses/${id}`);
  await expect(
    benPage.getByText("Only the person who added or paid this can change it."),
  ).toBeVisible();
  await expect(benPage.getByRole("link", { name: "Edit expense" })).toHaveCount(
    0,
  );
  await expect(
    benPage.getByRole("button", { name: "Delete expense" }),
  ).toHaveCount(0);
  await benPage.goto(`/expenses/${id}/edit`);
  await expect(benPage).toHaveURL(new RegExp(`/expenses/${id}$`));
  const put = await ben.api.delete(`/api/expenses/${id}`);
  expect(put.status()).toBe(403);
  expect((await put.json()).error).toContain(
    "Only the person who added this expense",
  );

  const page = await ana.page();
  await page.goto(`/expenses/${id}`);
  await page.getByRole("link", { name: "Edit expense" }).click();
  await hydrated(page);
  await expect(page.getByLabel("Title")).toHaveValue("Internet");
  await page.getByLabel("Title").fill("Fiber internet");
  await page.getByLabel("Amount").fill("80");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved Fiber internet");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Fiber internet",
  );
  await expect(page.getByText("Ben owes you $40.00")).toBeVisible();

  await page.getByRole("button", { name: "Delete expense" }).click();
  await page
    .getByRole("group", { name: /Delete "Fiber internet"/ })
    .getByRole("button", { name: "Delete expense" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
  await expect(page.getByRole("status")).toContainText(
    "Deleted Fiber internet",
  );
  await expect(page.getByText("No expenses yet")).toBeVisible();
});

test("a payer can edit an expense someone else added", async ({ as }) => {
  const ana = await as("Ana");
  const ben = await as("Ben");
  const groupId = await seedGroup(ana, [ben]);
  const id = await seedExpense(ana, groupId, "Gas", 5000, ben, [ana, ben]);
  const page = await ben.page();
  await page.goto(`/expenses/${id}`);
  await page.getByRole("link", { name: "Edit expense" }).click();
  await hydrated(page);
  await page.getByLabel("Amount").fill("70");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved Gas");
  await expect(page.getByText("Ana owes you $35.00")).toBeVisible();
});
