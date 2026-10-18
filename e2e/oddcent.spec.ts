import { expect, hydrated, seedGroup, test } from "./fixtures.ts";

test("the odd cent goes to whoever adds the expense, in the preview and once saved", async ({
  as,
}) => {
  const [ana, ben, cy] = await Promise.all([as("Ana"), as("Ben"), as("Cy")]);
  const groupId = await seedGroup(ana, [ben, cy]);
  const page = await ana.page();
  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  await page.getByLabel("Title").fill("Groceries");
  await page.getByLabel("Amount").fill("268.12");

  const summary = page.getByRole("region", { name: "Summary" });
  await expect(
    summary.getByRole("listitem").filter({ hasText: "Your share" }),
  ).toContainText("$89.38");
  await expect(
    summary.getByRole("listitem").filter({ hasText: "Ben's share" }),
  ).toContainText("$89.37");
  await expect(
    summary.getByRole("listitem").filter({ hasText: "Cy's share" }),
  ).toContainText("$89.37");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Groceries");

  const list = (await (
    await ana.api.get(`/api/groups/${groupId}/expenses`)
  ).json()) as Array<{
    title: string;
    shares: Record<number, number>;
  }>;
  const saved = list.find((e) => e.title === "Groceries")!;
  expect(saved.shares).toEqual({
    [ana.memberId]: 8938,
    [ben.memberId]: 8937,
    [cy.memberId]: 8937,
  });
});
