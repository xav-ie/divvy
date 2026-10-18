import { expect, hydrated, test } from "./fixtures.ts";

// The e2e server runs in dev mode, where emails can't be verified, so linking is off.
test("sign-in emails are listed, and linking says it needs Cloudflare sign-in", async ({
  as,
}) => {
  const ana = await as("Ana");
  const page = await ana.page();
  await page.goto("/profile");
  await hydrated(page);
  const section = page.getByRole("region", { name: "Sign-in emails" });
  await expect(section.getByRole("list", { name: "Emails" })).toContainText(
    ana.email,
  );
  await expect(section).toContainText("Primary");
  await expect(section).toContainText(
    "Adding emails is available with Cloudflare sign-in.",
  );
  await expect(
    section.getByRole("button", { name: "Add another email" }),
  ).toHaveCount(0);

  await page.goto("/link/not-a-code");
  await expect(page.getByTestId("link-problem")).toContainText(
    "available with Cloudflare sign-in",
  );
});
