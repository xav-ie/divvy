import { expect, hydrated, seedGroup, test } from "./fixtures.ts";

const now = new Date();
const month = now.toLocaleString("en-US", { month: "long" });
const short = now.toLocaleString("en-US", { month: "short" });
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

// Most bills here are due on the 1st, which has passed on any day but the 1st.
test.skip(now.getDate() === 1, "needs the 1st to have passed this month");

test("recurring bills: fixed amounts, include this month, pause, edit, delete", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const page = await ana.page();
  const all = page.getByRole("list", { name: "Recurring bills", exact: true });

  await page.goto(`/groups/${groupId}?tab=recurring`);
  await hydrated(page);
  await expect(
    page.getByText(
      "For fixed amounts like rent or subscriptions. Bills that change every month (electric, gas) are just regular expenses.",
    ),
  ).toBeVisible();

  // The amount is required; there's no "varies" kind any more.
  await page.getByRole("link", { name: "Add recurring bill" }).click();
  await hydrated(page);
  await expect(page.getByRole("radio", { name: "Amount varies" })).toHaveCount(
    0,
  );
  await page.getByLabel("Title").fill("Rent");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Enter an amount above $0.00")).toBeVisible();
  await page.getByLabel("Amount", { exact: true }).fill("1200");
  await expect(
    page.getByText(
      `The 1st already passed this month. Include ${month}'s bill?`,
    ),
  ).toBeVisible();
  // Including this month adds the bill right away and links it.
  await page.getByRole("radio", { name: `Yes, include ${month}` }).click();
  await page.getByRole("button", { name: "Save" }).click();
  const added = page.getByRole("status");
  await expect(added).toContainText(`Added ${month}'s Rent`);
  await added.getByRole("link", { name: "View" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rent");
  await expect(page.getByText("Ben owes you $600.00")).toBeVisible();
  await page.goto(`/groups/${groupId}?tab=recurring`);
  await hydrated(page);
  const rent = all.getByRole("listitem", { name: "Rent" });
  await expect(rent).toContainText(`Added for ${month}; next on`);
  await expect(rent).toContainText("You pay");
  // Bills add themselves: no button to add one early.
  await expect(rent.getByRole("button", { name: /bill/ })).toHaveCount(0);

  // Without "include", it starts next month.
  await page.getByRole("link", { name: "Add recurring bill" }).click();
  await hydrated(page);
  await page.getByLabel("Title").fill("Internet");
  await page.getByLabel("Amount", { exact: true }).fill("60");
  await page.getByRole("button", { name: "Save" }).click();
  await hydrated(page);
  const internet = all.getByRole("listitem", { name: "Internet" });
  const nextFirst = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    1,
  ).toLocaleString("en-US", { month: "short", day: "numeric" });
  await expect(internet).toContainText(`Starts ${nextFirst}`);
  await expect(internet).not.toContainText(`for ${month}`);

  await rent.getByRole("button", { name: "Pause" }).click();
  await expect(rent).toContainText(
    "Paused: nothing is added until you resume it",
  );
  await rent.getByRole("button", { name: "Resume" }).click();
  await expect(rent).toContainText(`Added for ${month}`);

  await rent.getByRole("link", { name: "Edit" }).click();
  await hydrated(page);
  await expect(page.getByLabel("Title")).toHaveValue("Rent");
  await expect(page.getByLabel("Amount", { exact: true })).toHaveValue(
    "1200.00",
  );
  await page.getByLabel("Title").fill("Rent and parking");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved Rent and parking");
  await hydrated(page);

  const renamed = all.getByRole("listitem", { name: "Rent and parking" });
  await renamed.getByRole("button", { name: "Delete" }).click();
  await renamed.getByRole("button", { name: "Delete" }).last().click();
  await expect(page.getByRole("status")).toHaveText("Deleted Rent and parking");
  await expect(
    all.getByRole("listitem", { name: "Rent and parking" }),
  ).toHaveCount(0);

  // The bill it already made stays, at the top of Expenses.
  const bill = page.getByRole("link", { name: /Rent/ });
  await expect(bill).toContainText("$1,200.00");
  await expect(bill).toContainText("You paid $1,200.00");
});

test("adding a deleted month again asks before adding it twice", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const both = { [ana.memberId]: 1, [ben.memberId]: 1 };
  const t = await ana.api.post(`/api/groups/${groupId}/recurring`, {
    data: {
      title: "Water",
      dayOfMonth: 1,
      amountCents: 3000,
      split: both,
      payerMemberId: ana.memberId,
      billThisMonth: true,
    },
  });
  expect(t.ok(), await t.text()).toBe(true);
  // Delete the bill it made, then enter it by hand as a regular expense.
  expect(
    (
      await ana.api.delete(`/api/expenses/${(await t.json()).expenseId}`)
    ).status(),
  ).toBe(204);
  const e = await ana.api.post(`/api/groups/${groupId}/expenses`, {
    data: {
      title: "Water",
      date: today,
      items: [
        {
          name: "Water",
          quantity: 1,
          unitCents: 3000,
          splitType: "equal",
          split: both,
        },
      ],
      payers: { [ana.memberId]: 3000 },
    },
  });
  const { id } = await e.json();

  const page = await ana.page();
  const all = page.getByRole("list", { name: "Recurring bills", exact: true });
  await page.goto(`/groups/${groupId}?tab=recurring`);
  await hydrated(page);
  const water = all.getByRole("listitem", { name: "Water" });
  await water
    .getByRole("button", { name: `Add ${month}'s bill again` })
    .click();
  await expect(water.getByRole("group", { name: "Add Water" })).toContainText(
    `Add Water for ${month}: $30.00`,
  );
  await water.getByRole("button", { name: "Add bill" }).click();
  const ask = water.getByRole("group", { name: "Add Water" });
  await expect(ask).toContainText(
    `Water for ${month} already looks entered: see that expense. Add anyway?`,
  );
  await expect(
    ask.getByRole("link", { name: "see that expense" }),
  ).toHaveAttribute("href", `/expenses/${id}`);
  await ask.getByRole("button", { name: "Add anyway" }).click();
  await expect(page.getByRole("status")).toHaveText(`Added Water for ${month}`);
});

test("an upcoming bill says the day it adds itself, and the list never flashes empty", async ({
  as,
}) => {
  test.skip(now.getDate() >= 28, "needs the 28th still ahead this month");
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const page = await ana.page();
  const all = page.getByRole("list", { name: "Recurring bills", exact: true });
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.body?.innerText.includes("For fixed amounts like rent"))
        (window as unknown as { sawEmpty: boolean }).sawEmpty = true;
    }).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await page.goto(`/groups/${groupId}/recurring/new`);
  await hydrated(page);
  await page.getByLabel("Title").fill("Phone");
  await page.getByLabel("Amount", { exact: true }).fill("45");
  await page.getByLabel("Day of the month").selectOption("28");
  await page.getByRole("button", { name: "Save" }).click();
  const row = all.getByRole("listitem", { name: "Phone" });
  await expect(row).toContainText(`divvy adds it automatically on ${short} 28`);
  await expect(row.getByRole("button", { name: /bill/ })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { sawEmpty?: boolean }).sawEmpty,
    ),
  ).toBeFalsy();
});

test("a deleted recurring bill is offered again by hand, not re-added", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const both = { [ana.memberId]: 1, [ben.memberId]: 1 };
  const t = await ana.api.post(`/api/groups/${groupId}/recurring`, {
    data: {
      title: "Gym",
      dayOfMonth: 1,
      amountCents: 4000,
      split: both,
      payerMemberId: ana.memberId,
      billThisMonth: true,
    },
  });
  const { expenseId } = await t.json();
  expect(expenseId).toBeGreaterThan(0);
  expect((await ana.api.delete(`/api/expenses/${expenseId}`)).status()).toBe(
    204,
  );

  const page = await ana.page();
  const all = page.getByRole("list", { name: "Recurring bills", exact: true });
  await page.goto(`/groups/${groupId}?tab=recurring`);
  await hydrated(page);
  const gym = all.getByRole("listitem", { name: "Gym" });
  await expect(gym).toContainText(
    `${month}'s bill was deleted; divvy won't add it again, add it yourself if needed`,
  );
  await gym.getByRole("button", { name: `Add ${month}'s bill again` }).click();
  await gym.getByRole("button", { name: "Add bill" }).click();
  await expect(page.getByRole("status")).toHaveText(`Added Gym for ${month}`);
  await expect(gym).toContainText(`Added for ${month}`);
});

test("the recurring list is collapsed by default, remembers being opened, and old links still work", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const both = { [ana.memberId]: 1, [ben.memberId]: 1 };
  await ana.api.post(`/api/groups/${groupId}/recurring`, {
    data: {
      title: "Internet",
      dayOfMonth: 1,
      amountCents: 6000,
      split: both,
      payerMemberId: ana.memberId,
    },
  });
  const page = await ana.page();
  await page.goto(`/groups/${groupId}`);
  await hydrated(page);
  const section = page.locator("details#recurring");
  await expect(section).not.toHaveAttribute("open", "");
  await expect(page.getByText("Recurring bills (1)")).toBeVisible();
  // Nothing sits at the top of Expenses any more.
  await expect(
    page.getByRole("list", { name: "Recurring bills due" }),
  ).toHaveCount(0);
  await page.getByText("Recurring bills (1)").click();
  await expect(section).toHaveAttribute("open", "");
  await page.reload();
  await hydrated(page);
  await expect(section).toHaveAttribute("open", "");

  // ?tab=recurring and the old members page redirect to their new homes.
  await page.goto(`/groups/${groupId}?tab=recurring`);
  await expect(page).toHaveURL(
    new RegExp(`/groups/${groupId}\\?recurring=1#recurring$`),
  );
  await hydrated(page);
  await expect(section).toHaveAttribute("open", "");
  await page.goto(`/groups/${groupId}/members`);
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}\\?tab=members$`));
  await expect(
    page.getByRole("link", { name: "Members", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("list", { name: "Members" })).toBeVisible();
});
