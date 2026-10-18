import { expect, test } from "./fixtures.ts";

test("create an assistant token, use it for MCP, revoke it", async ({
  as,
  playwright,
  baseURL,
}) => {
  const ana = await as("Ana");
  const page = await ana.page();
  await page.goto("/profile");
  const section = page.getByRole("region", { name: "Assistant access" });
  await section.getByLabel("Token name").fill("Claude laptop");
  await section.getByRole("button", { name: "Create token" }).click();
  await expect(
    section.getByText("Copy this token now. You won't see it again."),
  ).toBeVisible();
  const token = (await section.getByTestId("new-token").textContent())!;
  expect(token).toMatch(/^divvy_[0-9a-f]{8}_/);

  // A non-browser client using the token sees Ana's world.
  const mcp = await playwright.request.newContext({ baseURL });
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "e2e", version: "0" },
    },
  };
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/json, text/event-stream",
  };
  expect((await mcp.post("/mcp", { data: init, headers })).status()).toBe(200);

  await section.getByRole("button", { name: "Done" }).click();
  await expect(section.getByTestId("new-token")).toHaveCount(0);
  await expect(section.getByText("Claude laptop")).toBeVisible();
  await section.getByRole("button", { name: "Revoke" }).click();
  await section
    .getByRole("group", { name: /Revoke "Claude laptop"/ })
    .getByRole("button", { name: "Revoke" })
    .click();
  await expect(section.getByText("No tokens yet.")).toBeVisible();
  expect((await mcp.post("/mcp", { data: init, headers })).status()).toBe(401);
  await mcp.dispose();
});

test("copying a new token works, or selects it when the clipboard is unavailable", async ({
  as,
}) => {
  const ana = await as("Ana");
  const page = await ana.page();
  await page.goto("/profile");
  const section = page.getByRole("region", { name: "Assistant access" });
  await section.getByLabel("Token name").fill("Phone");
  await section.getByRole("button", { name: "Create token" }).click();
  const token = (await section.getByTestId("new-token").textContent())!;

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (t: string) => (
          ((window as unknown as { copied: string }).copied = t),
          Promise.resolve()
        ),
      },
    });
  });
  await section.getByRole("button", { name: "Copy" }).click();
  await expect(page.locator("#toasts").getByRole("status")).toHaveText(
    "Token copied",
  );
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe(token);

  // Plain http on the LAN has no clipboard API.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });
  await section.getByRole("button", { name: "Copy" }).click();
  await expect(section.getByRole("alert")).toHaveText(
    "Couldn't copy automatically. The token is selected; copy it yourself.",
  );
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(token);
});
