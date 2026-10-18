import {
  expect,
  hydrated,
  seedExpense,
  seedGroup,
  test,
  type Person,
} from "./fixtures.ts";

/** Ana paid $90 for all three; Ben paid $60 for himself and Cy. */
async function seed(ana: Person, ben: Person, cy: Person) {
  const groupId = await seedGroup(ana, [ben, cy]);
  await seedExpense(
    ana,
    groupId,
    "Groceries",
    9000,
    ana,
    [ana, ben, cy],
    "2026-10-01",
  );
  await seedExpense(
    ben,
    groupId,
    "Cleaning",
    6000,
    ben,
    [ben, cy],
    "2026-10-02",
  );
  return groupId;
}

test("balances read as sentences for each roommate, with simplify", async ({
  as,
}) => {
  const [ana, ben, cy] = await Promise.all([as("Ana"), as("Ben"), as("Cy")]);
  const groupId = await seed(ana, ben, cy);

  const page = await ana.page();
  await page.goto("/");
  await expect(page.getByTestId("overall")).toHaveText(
    "Overall, you're owed $60.00",
  );
  await expect(
    page.getByRole("link", { name: "Ben owes you $30.00" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cy owes you $30.00" }),
  ).toBeVisible();

  await page.goto(`/groups/${groupId}?tab=balances`);
  const pairs = page.getByRole("list", { name: "Who owes whom" });
  await expect(pairs.getByRole("listitem")).toHaveCount(3);
  for (const s of [
    "Ben owes you $30.00",
    "Cy owes you $30.00",
    "Cy owes Ben $30.00",
  ])
    await expect(pairs).toContainText(s);
  const totals = page.getByRole("list", { name: "Totals per person" });
  await expect(totals).toContainText("You are owed $60.00 in total");
  await expect(totals).toContainText("Ben is settled up");
  await expect(totals).toContainText("Cy owes $60.00 in total");

  // Simplify is saved for the group and carries to home and the other roommates.
  await page.getByRole("switch", { name: /Simplify/ }).check();
  await expect(page.getByRole("status")).toHaveText(
    "Simplify is on for this group",
  );
  await expect(pairs).toBeHidden();
  const simplified = page.getByRole("list", { name: "Simplified payments" });
  await expect(simplified.getByRole("listitem")).toHaveText([
    /Cy owes you \$60\.00/,
  ]);
  await page.reload();
  await expect(page.getByRole("switch", { name: /Simplify/ })).toBeChecked();
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Cy owes you $60.00" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Ben owes you/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Cy owes you $60.00" }).click();
  await expect(page.getByTestId("headline")).toHaveText("Cy owes you $60.00");
  await expect(page.getByText("Simplify is on in this group")).toBeVisible();
  await expect(page.getByTestId("running").first()).toHaveText(
    "Running total: Cy owes you $60.00",
  );

  await page.goto(`/groups/${groupId}?tab=balances`);
  await page.getByRole("switch", { name: /Simplify/ }).uncheck();
  await expect(page.getByRole("status")).toHaveText(
    "Simplify is off for this group",
  );
  await expect(pairs).toBeVisible();

  const benPage = await ben.page();
  await benPage.goto(`/groups/${groupId}?tab=balances`);
  const benPairs = benPage.getByRole("list", { name: "Who owes whom" });
  await expect(benPairs.getByRole("listitem")).toHaveCount(3);
  for (const s of [
    "You owe Ana $30.00",
    "Cy owes you $30.00",
    "Cy owes Ana $30.00",
  ])
    await expect(benPairs).toContainText(s);
  await benPage.goto("/");
  await expect(
    benPage.getByRole("link", { name: "You owe Ana $30.00" }),
  ).toBeVisible();
  await expect(
    benPage.getByRole("link", { name: "Cy owes you $30.00" }),
  ).toBeVisible();
});

test("drill-down running total ends at the headline, settle up clears it", async ({
  as,
}) => {
  const [ana, ben, cy] = await Promise.all([as("Ana"), as("Ben"), as("Cy")]);
  const groupId = await seed(ana, ben, cy);
  const pay = await ben.api.post(`/api/groups/${groupId}/payments`, {
    data: {
      fromMember: ben.memberId,
      toMember: ana.memberId,
      cents: 1000,
      date: "2026-10-03",
      note: "cash",
    },
  });
  expect(pay.ok()).toBe(true);

  const page = await ana.page();
  await page.goto("/");
  await page.getByRole("link", { name: "Ben owes you $20.00" }).click();
  await expect(page.getByTestId("headline")).toHaveText("Ben owes you $20.00");
  const lines = page
    .getByRole("list", { name: "Bills and payments" })
    .getByRole("listitem");
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText("cash: Ben paid you $10.00");
  await expect(lines.nth(0).getByTestId("running")).toHaveText(
    "Running total: Ben owes you $20.00",
  );
  await expect(lines.nth(1)).toContainText(
    "Groceries: you paid $90.00, your share $30.00, Ben's share $30.00, so Ben owes you $30.00",
  );
  await expect(lines.nth(1).getByTestId("running")).toHaveText(
    "Running total: Ben owes you $30.00",
  );
  // Entered today but dated earlier: both dates show.
  await expect(lines.nth(1).getByTestId("when")).toContainText(
    "dated Oct 1, added",
  );

  await page.goto(`/groups/${groupId}?tab=balances`);
  await page
    .getByRole("link", { name: "Settle up: Ben owes you $20.00" })
    .click();
  await hydrated(page);
  await expect(page.getByLabel("Amount")).toHaveValue("20.00");
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(
    String(ben.memberId),
  );
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(
    String(ana.memberId),
  );
  await expect(page.getByText("Ben paid you $20.00")).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Recorded: Ben paid you $20.00",
  );
  await expect(
    page.getByRole("list", { name: "Who owes whom" }),
  ).not.toContainText("Ben owes you");

  await page.goto(`/people/${ben.memberId}`);
  await expect(page.getByTestId("headline")).toHaveText(
    "You and Ben are settled up",
  );
  await expect(page.getByTestId("running").first()).toHaveText(
    "Settled up after this",
  );
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Ben owes you/ })).toHaveCount(0);
  await expect(page.getByTestId("overall")).toHaveText(
    "Overall, you're owed $30.00",
  );
});

test("record payment shows the server's error inline", async ({ as }) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const page = await ana.page();
  await page.goto(`/settle?groupId=${groupId}`);
  await hydrated(page);
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Enter an amount above $0.00")).toBeVisible();
  await page.getByLabel("Amount").fill("5");
  await page.getByLabel("Date").fill("");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("alert")).toContainText("date");
});

test("activity feed lists who changed what", async ({ as }) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  await seedExpense(ana, groupId, "Rent", 10000, ana, [ana, ben]);
  const pay = await ben.api.post(`/api/groups/${groupId}/payments`, {
    data: {
      fromMember: ben.memberId,
      toMember: ana.memberId,
      cents: 5000,
      date: "2026-10-05",
    },
  });
  const { id } = await pay.json();
  await ben.api.delete(`/api/payments/${id}`);

  const page = await ana.page();
  await page.goto(`/groups/${groupId}`);
  await page.getByRole("link", { name: "Activity" }).click();
  const feed = page.getByRole("list", { name: "Activity" });
  await expect(feed.getByRole("listitem").locator("p:first-child")).toHaveText([
    "Ben deleted a payment (Ben paid you $50.00)",
    "Ben paid you $50.00",
    'You added "Rent" ($100.00)',
  ]);
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Activity" })).toContainText(
    'You added "Rent" ($100.00)',
  );

  // Ben sees the same feed from his side.
  const benPage = await ben.page();
  await benPage.goto(`/groups/${groupId}?tab=activity`);
  const benFeed = benPage
    .getByRole("list", { name: "Activity" })
    .getByRole("listitem")
    .locator("p:first-child");
  await expect(benFeed.nth(1)).toHaveText("You paid Ana $50.00");
  await expect(benFeed.nth(2)).toHaveText('Ana added "Rent" ($100.00)');
});

test("switching groups on settle up starts from you again", async ({ as }) => {
  const [ana, ben, cy] = await Promise.all([as("Ana"), as("Ben"), as("Cy")]);
  const flat = await seedGroup(ana, [ben], "Flat");
  const trip = await seedGroup(ana, [cy], "Trip");
  const page = await ana.page();
  await page.goto("/settle");
  await hydrated(page);
  await page.getByLabel("Group").selectOption(String(flat));
  await page
    .getByLabel("From", { exact: true })
    .selectOption(String(ben.memberId));
  await page.getByLabel("Group").selectOption(String(trip));
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(
    String(ana.memberId),
  );
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(
    String(cy.memberId),
  );
});

test("simplify says when it wouldn't change anything", async ({ as }) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  await seedExpense(ana, groupId, "Pizza", 2000, ana, [ana, ben]);
  const page = await ana.page();
  await page.goto(`/groups/${groupId}?tab=balances`);
  await expect(
    page.getByText("Already as simple as it gets: no payment would change."),
  ).toBeVisible();
  // The Simplify card keeps the usual gap above the balances list.
  const card = (await page
    .locator(".card")
    .filter({ hasText: "Already as simple as it gets" })
    .boundingBox())!;
  const list = (await page
    .getByRole("list", { name: "Who owes whom" })
    .boundingBox())!;
  expect(list.y - (card.y + card.height)).toBeGreaterThanOrEqual(12);
});

test("record payment starts from the biggest debt you owe in the group", async ({
  as,
}) => {
  const [ana, ben, cy] = await Promise.all([as("Ana"), as("Ben"), as("Cy")]);
  const flat = await seedGroup(ana, [ben, cy], "Flat");
  const trip = await seedGroup(ana, [cy], "Trip");
  await seedExpense(ben, flat, "Groceries", 6000, ben, [ana, ben]);
  await seedExpense(cy, flat, "Soap", 2000, cy, [ana, cy]);

  const page = await ana.page();
  await page.goto(`/groups/${flat}`);
  await page.getByRole("link", { name: "Record payment" }).click();
  await hydrated(page);
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(
    String(ana.memberId),
  );
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(
    String(ben.memberId),
  );
  await expect(page.getByLabel("Amount")).toHaveValue("30.00");
  await expect(page.getByText("You paid Ben $30.00")).toBeVisible();

  // Nothing owed in Trip: you paying the first other person, amount left empty.
  await page.goto("/settle");
  await hydrated(page);
  await page.getByLabel("Group").selectOption(String(trip));
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(
    String(ana.memberId),
  );
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(
    String(cy.memberId),
  );
  await expect(page.getByLabel("Amount")).toHaveValue("");
});
