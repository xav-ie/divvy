import type { Locator, Page } from "@playwright/test";
import { expect, seedExpense, seedGroup, test } from "./fixtures.ts";

/** The confirmation must sit inside the viewport and above the phone's bottom tab bar. */
async function expectAboveBar(page: Page, confirm: Locator) {
  await expect(confirm).toBeVisible();
  await page.waitForTimeout(400); // smooth scroll
  const box = (await confirm.boundingBox())!;
  const bar = page.locator("nav.fixed");
  const limit = (await bar.isVisible())
    ? (await bar.boundingBox())!.y
    : page.viewportSize()!.height;
  expect(box.y + box.height).toBeLessThanOrEqual(limit);
  expect(box.y).toBeGreaterThanOrEqual(0);
}

test("delete confirmations stay above the bottom bar", async ({ as }) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const id = await seedExpense(ana, groupId, "Lamp", 3000, ana, [ana, ben]);
  const page = await ana.page();
  await page.goto(`/expenses/${id}`);
  const del = page.getByRole("button", { name: "Delete expense" });
  // Put the button right at the bottom edge, where the confirmation used to fall under the tabs.
  await del.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await del.click();
  await expectAboveBar(
    page,
    page.getByRole("group", { name: /Delete "Lamp"/ }),
  );
  await page
    .getByRole("group", { name: /Delete "Lamp"/ })
    .getByRole("button", { name: "Cancel" })
    .click();

  const pay = await ana.api.post(`/api/groups/${groupId}/payments`, {
    data: {
      fromMember: ben.memberId,
      toMember: ana.memberId,
      cents: 500,
      date: "2026-10-02",
    },
  });
  expect(pay.ok()).toBe(true);
  await page.goto(`/groups/${groupId}`);
  await page.getByText("Ben paid you $5.00").click();
  const delPay = page.getByRole("button", { name: "Delete payment" });
  await delPay.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await delPay.click();
  await expectAboveBar(
    page,
    page.getByRole("group", { name: /Delete the payment/ }),
  );
});
