import { expect, hydrated, seedExpense, seedGroup, test } from "./fixtures.ts";

test("create a group, add a placeholder and invite them, add a roommate by email", async ({
  as,
  emailOf,
}) => {
  const ana = await as("Ana");
  const ben = await as("Ben");
  const page = await ana.page();

  await page.goto("/groups");
  await hydrated(page);
  // No groups yet: the form is already open, with a line on what a group is.
  await expect(
    page.getByText("A group is the people you split bills with"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await page.getByLabel("Emoji").fill("🏠");
  await page.getByLabel("Group name").fill("Maple St");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "🏠 Maple St",
  );
  await expect(page.getByRole("status")).toHaveText("Created Maple St");

  await page.getByRole("link", { name: "Members" }).click();
  await hydrated(page);
  const add = page.getByRole("form", { name: "Add someone" });
  await add.getByLabel("Name").fill("Dee");
  await add.getByRole("button", { name: "Add to group" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Dee");
  const members = page.getByRole("list", { name: "Members" });
  await expect(
    members.getByRole("listitem").filter({ hasText: "Dee" }),
  ).toContainText("Placeholder, not invited yet");

  await page.getByRole("button", { name: "Invite Dee" }).click();
  await page.getByLabel("Email for Dee").fill(emailOf("Dee"));
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("status")).toHaveText(
    `Invited Dee as ${emailOf("Dee")}`,
  );
  await expect(
    members.getByRole("listitem").filter({ hasText: "Dee" }),
  ).toContainText(`Invited as ${emailOf("Dee")}`);

  await add.getByLabel("Email (optional)").fill(ben.email);
  await add.getByRole("button", { name: "Add to group" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Ben");
  await expect(
    members.getByRole("listitem").filter({ hasText: "Ben" }),
  ).toContainText("Member");

  // A repeat add shows the server's error inline.
  await add.getByLabel("Email (optional)").fill(ben.email);
  await add.getByRole("button", { name: "Add to group" }).click();
  await expect(add.getByRole("alert")).toHaveText(
    "They're already in this group",
  );

  // When Dee signs in, she takes over the placeholder.
  const dee = await as("Dee");
  const deePage = await dee.page();
  await deePage.goto("/groups");
  await expect(deePage.getByRole("link", { name: /Maple St/ })).toBeVisible();
});

test("only the creator can rename, remove members or delete the group", async ({
  as,
}) => {
  const ana = await as("Ana");
  const ben = await as("Ben");
  const res = await ana.api.post("/api/groups", {
    data: { name: "Lake house" },
  });
  const { id } = await res.json();
  await ana.api.post(`/api/groups/${id}/members`, {
    data: { email: ben.email },
  });
  await ana.api.post(`/api/groups/${id}/members`, { data: { name: "Cy" } });

  const benPage = await ben.page();
  await benPage.goto(`/groups/${id}/members`);
  await hydrated(benPage);
  await expect(
    benPage.getByRole("form", { name: "Add someone" }),
  ).toBeVisible();
  await expect(
    benPage.getByRole("form", { name: "Group settings" }),
  ).toHaveCount(0);
  await expect(benPage.getByRole("button", { name: /^Remove / })).toHaveCount(
    0,
  );
  await expect(
    benPage.getByRole("button", { name: /^More actions for/ }),
  ).toHaveCount(0);

  const page = await ana.page();
  await page.goto(`/groups/${id}/members`);
  await hydrated(page);
  // Remove hides behind "More"; no red button on every row.
  await expect(page.getByRole("button", { name: "Remove Cy" })).toHaveCount(0);
  await page.getByRole("button", { name: "More actions for Cy" }).click();
  await page.getByRole("button", { name: "Remove Cy" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Removed Cy");
  await expect(page.getByRole("list", { name: "Members" })).not.toContainText(
    "Cy",
  );

  await page.getByLabel("Group name").fill("Cabin");
  await page.getByRole("button", { name: "Save group" }).click();
  await expect(page.getByRole("status")).toHaveText("Group saved");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cabin");

  await page.getByRole("button", { name: "Delete group" }).click();
  await page
    .getByRole("group", { name: /Delete Cabin/ })
    .getByRole("button", { name: "Delete group" })
    .click();
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole("status")).toHaveText("Deleted Cabin");
  await expect(page.getByRole("link", { name: /Cabin/ })).toHaveCount(0);
});

test("someone with a balance can't be removed, and the page says why", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  await seedExpense(ana, groupId, "Rent", 10000, ana, [ana, ben]);
  const page = await ana.page();
  await page.goto(`/groups/${groupId}/members`);
  await hydrated(page);
  await expect(page.getByText("Settle up before removing Ben")).toHaveCount(0);
  await page.getByRole("button", { name: "More actions for Ben" }).click();
  await expect(page.getByRole("button", { name: "Remove Ben" })).toBeDisabled();
  await expect(
    page.getByText("Ben owes $50.00 in total. Settle up before removing Ben."),
  ).toBeVisible();
});

test("with groups, New group opens the form on demand and Cancel closes it", async ({
  as,
}) => {
  const ana = await as("Ana");
  await seedGroup(ana, [], "Maple St");
  const page = await ana.page();
  await page.goto("/groups");
  await hydrated(page);
  await expect(page.getByRole("link", { name: /Maple St/ })).toBeVisible();
  await expect(page.getByRole("form", { name: "New group" })).toHaveCount(0);
  await page.getByRole("button", { name: "New group" }).click();
  const form = page.getByRole("form", { name: "New group" });
  await expect(form.getByLabel("Group name")).toBeFocused();
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole("button", { name: "New group" }).click();
  await form.getByLabel("Group name").fill("Lake house");
  await form.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByRole("status")).toHaveText("Created Lake house");
});
