import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Runs against the picker-mode server (see playwright.config.ts).
test("pick a name, add a new person, switch person", async ({ page }, info) => {
  const tag = info.project.name;
  const first = `Ana ${tag}`;
  const second = `Ben ${tag}`;

  await page.goto("/groups");
  await expect(page).toHaveURL(/\/who$/);
  await expect(page.getByTestId("picker-note")).toHaveText(
    "Anyone on this network can pick any name. Proper sign-in comes with Cloudflare Access.",
  );
  await expect(page.getByLabel("Your name")).toBeVisible();
  if (tag === "picker-phone") {
    mkdirSync("/tmp/divvy-shots", { recursive: true });
    await page.screenshot({ path: "/tmp/divvy-shots/who.png", fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: "/tmp/divvy-shots/who-dark.png",
      fullPage: true,
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 360, height: 780 });
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, "/who scrolls sideways").toBeLessThanOrEqual(0);
  }

  // New person.
  await page.getByLabel("Your name").fill(first);
  await page.getByLabel("Your email").fill(`ana.${tag}@e2e.test`);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/profile");
  await expect(page.getByTestId("user-email")).toHaveText(
    `ana.${tag}@e2e.test`,
  );

  // Same email again is refused with the server's message.
  await page.getByRole("button", { name: "Switch person" }).click();
  await expect(page).toHaveURL(/\/who$/);
  if (tag === "picker-phone")
    await page.screenshot({
      path: "/tmp/divvy-shots/who-list.png",
      fullPage: true,
    });
  await page.getByLabel("Your name").fill("Someone");
  await page.getByLabel("Your email").fill(`ana.${tag}@e2e.test`);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Someone already uses that email; pick their name instead",
  );

  // A second person, then switch back to the first by tapping their name.
  await page.getByLabel("Your name").fill(second);
  await page.getByLabel("Your email").fill(`ben.${tag}@e2e.test`);
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/profile");
  await expect(page.getByTestId("user-email")).toHaveText(
    `ben.${tag}@e2e.test`,
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/who$/);
  await page.getByRole("button", { name: first, exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/profile");
  await expect(page.getByTestId("user-email")).toHaveText(
    `ana.${tag}@e2e.test`,
  );
});
