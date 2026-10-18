import { expect, hydrated, seedExpense, seedGroup, test } from "./fixtures.ts";

test("itemize off and on keeps the items and carries the total", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const page = await ana.page();
  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  await page.getByLabel("Title").fill("Market");
  await page.getByLabel("Amount").fill("20");
  const itemize = page.getByRole("switch", { name: "Itemize" });
  await itemize.click();
  await expect(itemize).toHaveAttribute("aria-checked", "true");
  // The first item starts from the amount, with its name left to type.
  const first = page.getByRole("group", { name: "Item 1" });
  const firstName = first.getByLabel("Item 1", { exact: true });
  await expect(firstName).toHaveValue("");
  await expect(firstName).toHaveAttribute("placeholder", "e.g. Pizza");
  await expect(first.getByLabel("Price each")).toHaveValue("20");
  await firstName.fill("Apples");
  await page.getByRole("button", { name: "Add item" }).click();
  const second = page.getByRole("group", { name: "Item 2" });
  await second.getByLabel("Item 2", { exact: true }).fill("Bread");
  await second.getByLabel("Price each").fill("4");
  await expect(page.getByTestId("total")).toHaveText("$24.00");

  // Off carries the items' total into Amount.
  await itemize.click();
  await expect(page.getByLabel("Amount")).toHaveValue("24.00");
  await expect(page.getByTestId("total")).toHaveText("$24.00");
  await itemize.click();
  await expect(firstName).toHaveValue("Apples");
  await expect(
    page
      .getByRole("group", { name: "Item 2" })
      .getByLabel("Item 2", { exact: true }),
  ).toHaveValue("Bread");
  await expect(page.getByTestId("total")).toHaveText("$24.00");
});

test("percent and exact splits say what's left or over", async ({ as }) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const page = await ana.page();
  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  await page.getByLabel("Title").fill("Rent");
  await page.getByLabel("Amount").fill("30");
  const status = page.getByTestId("split-status");

  await page.getByRole("radio", { name: "By %" }).click();
  await expect(status).toHaveText("You $15.00 · Ben $15.00");
  await page.getByLabel("You (%)").fill("40");
  await expect(status).toHaveText("10% left");
  // No dollar figures while the split doesn't add up.
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(summary).toContainText("Shares show once every split adds up.");
  await expect(summary.getByText("Your share")).toBeHidden();
  await page.getByLabel("You (%)").fill("55");
  await expect(status).toHaveText("5% over");
  await page.getByLabel("You (%)").fill("60");
  await page.getByLabel("Ben (%)").fill("40");
  await expect(status).toHaveText("You $18.00 · Ben $12.00");

  await page.getByRole("radio", { name: "By amount" }).click();
  await expect(status).toHaveText("You $15.00 · Ben $15.00");
  await page.getByLabel("Ben ($)").fill("12");
  await expect(status).toHaveText("$3.00 left");
  await page.getByLabel("Ben ($)").fill("16");
  await expect(status).toHaveText("$1.00 over");
});

test("an empty form shows one message per empty field", async ({ as }) => {
  const ana = await as("Ana");
  const groupId = await seedGroup(ana, []);
  const page = await ana.page();
  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Give the expense a title")).toHaveCount(1);
  await expect(page.getByText("Enter an amount above $0.00")).toHaveCount(1);
  await expect(
    page.getByText(/needs a price|must be more than|Someone has to have paid/),
  ).toHaveCount(0);
});

test("leaving a half-filled form asks first", async ({ as }) => {
  const ana = await as("Ana");
  const groupId = await seedGroup(ana, []);
  const page = await ana.page();
  // Back to the group: the back button on phones, the breadcrumb on desktop.
  const toGroup = page
    .getByRole("link", { name: /Flat/ })
    .filter({ visible: true });
  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);

  // Untouched forms leave without asking.
  await toGroup.click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
  await page.getByRole("link", { name: "Add expense" }).click();
  await hydrated(page);

  await page.getByLabel("Title").fill("Half done");
  await toGroup.click();
  const dialog = page.getByRole("alertdialog", {
    name: "Leave without saving?",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Title")).toHaveValue("Half done");

  // The browser asks too on reload or closing.
  const prompt = page.waitForEvent("dialog");
  void page.reload().catch(() => {});
  const d = await prompt;
  expect(d.type()).toBe("beforeunload");
  await d.dismiss();
  await expect(page.getByLabel("Title")).toHaveValue("Half done");

  await toGroup.click();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));

  // Saving never asks.
  await page.getByRole("link", { name: "Add expense" }).click();
  await hydrated(page);
  await page.getByLabel("Title").fill("Snacks");
  await page.getByLabel("Amount").fill("5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Added Snacks");
});

test("deleting an expense or payment can be undone from the toast", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const id = await seedExpense(ana, groupId, "Water", 4000, ana, [ana, ben]);
  const page = await ana.page();
  await page.goto(`/expenses/${id}`);
  await page.getByRole("button", { name: "Delete expense" }).click();
  await page
    .getByRole("group", { name: /Delete "Water"/ })
    .getByRole("button", { name: "Delete expense" })
    .click();
  const toast = page.getByRole("status");
  await expect(toast).toContainText("Deleted Water");
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("status")).toContainText("Restored Water");
  const row = page.getByRole("link", { name: /Water/ });
  await expect(row).toContainText("$40.00");
  // The same expense comes back, not a copy.
  await expect(row).toHaveAttribute("href", `/expenses/${id}`);
  await row.click();
  await expect(page.getByText("Ben owes you $20.00")).toBeVisible();

  const pay = await ben.api.post(`/api/groups/${groupId}/payments`, {
    data: {
      fromMember: ben.memberId,
      toMember: ana.memberId,
      cents: 2000,
      date: "2026-10-02",
    },
  });
  expect(pay.ok()).toBe(true);
  await page.goto(`/groups/${groupId}`);
  await page.getByText("Ben paid you $20.00").click();
  await page.getByRole("button", { name: "Delete payment" }).click();
  await page
    .getByRole("group", { name: /Delete the payment/ })
    .getByRole("button", { name: "Delete payment" })
    .click();
  await expect(page.getByRole("status")).toContainText("Payment deleted");
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("status")).toContainText("Payment restored");
  await expect(page.getByText("Ben paid you $20.00")).toBeVisible();
});

test("editing keeps the category; one-person items read 'Only you'", async ({
  as,
}) => {
  const ana = await as("Ana");
  const ben = await as("Ben");
  const groupId = await seedGroup(ana, [ben]);
  const res = await ana.api.post(`/api/groups/${groupId}/expenses`, {
    data: {
      title: "Coffee",
      date: "2026-10-01",
      category: "food",
      items: [
        {
          name: "Coffee",
          quantity: 1,
          unitCents: 450,
          splitType: "equal",
          split: { [ana.memberId]: 1 },
        },
      ],
      payers: { [ana.memberId]: 450 },
    },
  });
  const { id } = await res.json();
  const page = await ana.page();
  await page.goto(`/expenses/${id}`);
  await expect(page.getByText("Only you")).toBeVisible();
  await page.getByRole("link", { name: "Edit expense" }).click();
  await hydrated(page);
  await page.getByLabel("Title").fill("Coffee beans");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved Coffee beans");
  const saved = await (await ana.api.get(`/api/expenses/${id}`)).json();
  expect(saved.category).toBe("food");
});

test("an expired sign-in says so and offers a reload", async ({ as }) => {
  const ana = await as("Ana");
  const groupId = await seedGroup(ana, []);
  const page = await ana.page();
  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  // Cloudflare Access answers an expired session with a redirect to its login page.
  await page.route(`**/api/groups/${groupId}/expenses`, (r) =>
    r.abort("failed"),
  );
  await page.route("**/api/me", (r) =>
    r.fulfill({
      status: 302,
      headers: {
        location: "https://team.cloudflareaccess.com/cdn-cgi/access/login",
      },
    }),
  );
  await page.getByLabel("Title").fill("Milk");
  await page.getByLabel("Amount").fill("3");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("Your sign-in expired.");
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("toasts don't cover the group tabs", async ({ as }) => {
  const ana = await as("Ana");
  const groupId = await seedGroup(ana, []);
  const page = await ana.page();
  await page.goto("/groups");
  await hydrated(page);
  await page.getByRole("button", { name: "New group" }).click();
  await page.getByLabel("Group name").fill("Tabs");
  await page.getByRole("button", { name: "Create group" }).click();
  const toast = page.getByRole("status");
  await expect(toast).toBeVisible();
  const t = (await toast.boundingBox())!;
  const tabs = (await page
    .getByRole("navigation", { name: "Group sections" })
    .boundingBox())!;
  expect(t.y > tabs.y + tabs.height || t.y + t.height < tabs.y).toBe(true);
  void groupId;
});

test("editing keeps a percent tax as a percent and recomputes it", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const both = { [ana.memberId]: 1, [ben.memberId]: 1 };
  const res = await ana.api.post(`/api/groups/${groupId}/expenses`, {
    data: {
      title: "Lunch",
      date: "2026-10-01",
      items: [
        {
          name: "Soup",
          quantity: 1,
          unitCents: 1000,
          splitType: "equal",
          split: both,
        },
        {
          name: "Salad",
          quantity: 1,
          unitCents: 2000,
          splitType: "equal",
          split: both,
        },
      ],
      taxMode: "percent",
      taxValue: 8,
      payers: { [ana.memberId]: 3240 },
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { id } = await res.json();

  const page = await ana.page();
  await page.goto(`/expenses/${id}`);
  await expect(page.getByText("Tax (8%)")).toBeVisible();
  await page.getByRole("link", { name: "Edit expense" }).click();
  await hydrated(page);
  await expect(
    page.getByRole("radio", { name: "Tax in percent" }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Tax", { exact: true })).toHaveValue("8");
  await expect(page.getByTestId("total")).toHaveText("$32.40");
  await page
    .getByRole("group", { name: "Item 2" })
    .getByLabel("Price each")
    .fill("30");
  await expect(page.getByTestId("total")).toHaveText("$43.20");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved Lunch");
  await expect(page.getByText("$43.20", { exact: true })).toBeVisible();
  await expect(page.getByText("Tax (8%)")).toBeVisible();
});

test("name fields stop at 40 characters and count down near the limit", async ({
  as,
}) => {
  const ana = await as("Ana");
  const page = await ana.page();
  await page.goto("/profile");
  await hydrated(page);
  const name = page.getByLabel("Your name");
  await name.fill("A".repeat(35));
  await expect(page.getByText("35/40 characters")).toBeVisible();
  await name.pressSequentially("BBBBBBBBBB");
  await expect(name).toHaveValue(`${"A".repeat(35)}BBBBB`);
  await expect(page.getByText("40/40 characters")).toBeVisible();
});

test("long names end in an ellipsis inside chips", async ({ as }) => {
  const ana = await as("Ana");
  const groupId = await seedGroup(ana, []);
  const long = "Bartholomew Maximilian Featherstonehaugh";
  await ana.api.post(`/api/groups/${groupId}/members`, {
    data: { name: long },
  });
  const page = await ana.page();
  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  const chip = page.getByRole("radio", { name: long });
  await expect(chip).toHaveAttribute("title", long);
  const fits = await chip.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const parent = el.parentElement!.getBoundingClientRect();
    const text = el.querySelector(".truncate")!;
    return (
      box.right <= parent.right + 0.5 &&
      getComputedStyle(text).textOverflow === "ellipsis"
    );
  });
  expect(fits).toBe(true);
});
