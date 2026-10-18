import { expect, hydrated, seedGroup, test } from "./fixtures.ts";

test("only the group's creator can rename or invite a placeholder", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const r = await ana.api.post(`/api/groups/${groupId}/members`, {
    data: { name: "Cy" },
  });
  expect(r.ok()).toBe(true);

  // Ben (not the creator) sees Cy's status but no way to rename or invite.
  const pb = await ben.page();
  await pb.goto(`/groups/${groupId}/members`);
  await hydrated(pb);
  const benList = pb.getByRole("list", { name: "Members" });
  await expect(
    benList.getByRole("listitem").filter({ hasText: "Cy" }),
  ).toContainText("Placeholder, not invited yet");
  await expect(pb.getByRole("button", { name: "Rename Cy" })).toHaveCount(0);
  await expect(pb.getByRole("button", { name: "Invite Cy" })).toHaveCount(0);
  await expect(
    pb.getByRole("button", { name: /^More actions for/ }),
  ).toHaveCount(0);

  // Ana, the creator, renames Cy.
  const pa = await ana.page();
  await pa.goto(`/groups/${groupId}/members`);
  await hydrated(pa);
  const members = pa.getByRole("list", { name: "Members" });
  await expect(members.getByRole("button", { name: "Rename Ana" })).toHaveCount(
    0,
  );
  await pa.getByRole("button", { name: "Rename Cy" }).click();
  await pa.getByLabel("New name for Cy").fill("Cyrus");
  await pa.getByRole("button", { name: "Save name" }).click();
  await expect(pa.getByRole("status")).toHaveText("Renamed Cy to Cyrus");
  await expect(
    members.getByRole("listitem").filter({ hasText: "Cyrus" }),
  ).toContainText("Placeholder, not invited yet");
  await expect(pa.getByRole("button", { name: "Invite Cyrus" })).toHaveCount(1);
});
