import { expect, hydrated, seedGroup, test } from "./fixtures.ts";

const local = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const now = new Date();
const inTwoWeeks = local(
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 14),
);

test("chores: turn on, add, swap a turn, time away, turn off", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const page = await ana.page();
  const tabs = page.getByRole("navigation", { name: "Group sections" });

  // Off until someone turns it on in Members.
  await page.goto(`/groups/${groupId}?tab=members`);
  await hydrated(page);
  await expect(tabs.getByRole("link", { name: "Chores" })).toHaveCount(0);
  await page.getByRole("switch", { name: /Chores/ }).check();
  await expect(page.getByRole("status")).toContainText(
    "Chores are on for this group",
  );
  await hydrated(page);
  await expect(tabs.getByRole("link", { name: "Chores" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // A chore: name required; the first person in the order goes first, today.
  await page.getByRole("link", { name: "Add chore" }).click();
  await hydrated(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Give the chore a name")).toBeVisible();
  await page.getByLabel("Name").fill("Dishes");
  await page
    .getByLabel("What to do (one step per line)")
    .fill("Load the dishwasher\nRun it when it's full");
  const order = page.getByRole("list", { name: "Order of turns" });
  await expect(order.getByRole("listitem")).toHaveText([/You/, /Ben/]);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved Dishes");
  await hydrated(page);
  const dishes = page
    .getByRole("list", { name: "Chores" })
    .getByRole("listitem", { name: "Dishes" });
  await expect(dishes).toContainText("You're up until");
  await expect(dishes).toContainText("Next: Ben");
  await expect(dishes.getByText("Run it when it's full")).toBeVisible();

  // Swap today's turn with Ben: he takes it, Ana takes his next one.
  await dishes.getByText("Schedule (").click();
  await dishes
    .getByRole("button", { name: /^Swap your turn/ })
    .first()
    .click();
  await dishes
    .getByRole("group", { name: "Swap your turn" })
    .getByRole("button", { name: /Ben/ })
    .click();
  await expect(page.getByRole("status")).toContainText("Swapped: Ben takes");
  await hydrated(page);
  await expect(dishes).toContainText("Now: Ben, until");
  await expect(dishes).toContainText("(swapped with you)");

  // Ben sees it's his turn on Home.
  const benPage = await ben.page();
  await benPage.goto("/");
  await expect(
    benPage.getByRole("link", { name: /Dishes: you're up until/ }),
  ).toBeVisible();

  // Time away: the day back has to come after leaving; then it shows and goes.
  await page.getByRole("button", { name: "Add time away" }).click();
  await page
    .getByRole("group", { name: "Add time away" })
    .getByRole("button", { name: "Save" })
    .click();
  await expect(
    page.getByText("Pick the day they're back, after they leave"),
  ).toBeVisible();
  await page.getByLabel("Back on").fill(inTwoWeeks);
  await page
    .getByRole("group", { name: "Add time away" })
    .getByRole("button", { name: "Save" })
    .click();
  await expect(page.getByRole("status")).toContainText("You're away until");
  await hydrated(page);
  const away = page.getByRole("list", { name: "Time away" });
  await expect(away).toContainText("Away now, back");
  await away.getByRole("button", { name: /Remove/ }).click();
  await page
    .getByRole("button", { name: "Remove", exact: true })
    .last()
    .click();
  await expect(page.getByRole("status")).toContainText("Time away removed");
  await hydrated(page);
  await expect(page.getByRole("list", { name: "Time away" })).toHaveCount(0);

  // Edit, then turn chores off: the tab goes away.
  await dishes.getByRole("link", { name: "Edit" }).click();
  await hydrated(page);
  await expect(page.getByLabel("Name")).toHaveValue("Dishes");
  await page.getByRole("button", { name: "Move Ben earlier" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved Dishes");
  await page.goto(`/groups/${groupId}?tab=members`);
  await hydrated(page);
  await page.getByRole("switch", { name: /Chores/ }).uncheck();
  await expect(page.getByRole("status")).toContainText(
    "Chores are off for this group",
  );
  await hydrated(page);
  await expect(tabs.getByRole("link", { name: "Chores" })).toHaveCount(0);
});
