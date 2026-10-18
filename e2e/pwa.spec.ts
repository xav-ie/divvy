import { expect, test } from "./fixtures.ts";

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (b: Buffer) => ({
  width: b.readUInt32BE(16),
  height: b.readUInt32BE(20),
});

test("installable: manifest, icons, head tags and a registered service worker", async ({
  as,
}, info) => {
  const ana = await as("Ana");

  const res = await ana.api.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toMatch(
    /application\/manifest\+json|application\/json/,
  );
  const manifest = await res.json();
  expect(manifest).toMatchObject({
    name: "divvy",
    short_name: "divvy",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#0b7560",
    background_color: "#f6f6f4",
  });
  const purposes = manifest.icons.map((i: { purpose: string }) => i.purpose);
  expect(purposes).toEqual(
    expect.arrayContaining(["any", "maskable", "monochrome"]),
  );
  const icons = [
    ...manifest.icons.map((i: { src: string; sizes: string }) => [
      i.src,
      i.sizes,
    ]),
    ["/icons/apple-touch-icon.png", "180x180"],
  ];
  for (const [src, sizes] of icons) {
    const png = await ana.api.get(src);
    expect(png.ok(), src).toBe(true);
    const { width, height } = pngSize(await png.body());
    expect(`${width}x${height}`, src).toBe(sizes);
  }
  expect((await ana.api.get("/favicon.svg")).ok()).toBe(true);
  const ico = await (await ana.api.get("/favicon.ico")).body();
  expect(ico.readUInt16LE(2)).toBe(1);

  const page = await ana.page();
  await page.goto("/");
  const head = page.locator("head");
  await expect(head.locator('link[rel="manifest"]')).toHaveAttribute(
    "crossorigin",
    "use-credentials",
  );
  await expect(head.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/icons/apple-touch-icon.png",
  );
  await expect(head.locator('meta[name="theme-color"]')).toHaveCount(2);
  await expect(
    head.locator('meta[name="apple-mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  await expect(head.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    /viewport-fit=cover/,
  );

  // The worker registers for the whole site and never takes over requests.
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, active: !!reg.active };
  });
  expect(sw.active).toBe(true);
  expect(new URL(sw.scope).pathname).toBe("/");

  // Chrome's own installability check finds nothing missing.
  if (info.project.name === "desktop") {
    const cdp = await page.context().newCDPSession(page);
    const { installabilityErrors } = await cdp.send(
      "Page.getInstallabilityErrors",
    );
    // Headless contexts are incognito-like; that's the only thing allowed to be "missing".
    expect(
      installabilityErrors
        .map((e: { errorId: string }) => e.errorId)
        .filter((id: string) => id !== "in-incognito"),
    ).toEqual([]);
  }
});

test("pages and client-side navigation still work with the service worker active", async ({
  as,
}) => {
  const ana = await as("Ana");
  const page = await ana.page();
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(
    page.evaluate(() => !!navigator.serviceWorker.controller),
  ).resolves.toBe(true);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Groups", exact: true })
    .click();
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Groups");
  // API calls keep reaching the server (no stale copies).
  const before = await page.evaluate(
    async () =>
      ((await (await fetch("/api/me")).json()) as { name: string }).name,
  );
  await ana.api.patch("/api/me", { data: { name: "Ana Lopez" } });
  const after = await page.evaluate(
    async () =>
      ((await (await fetch("/api/me")).json()) as { name: string }).name,
  );
  expect([before, after]).toEqual(["Ana", "Ana Lopez"]);
});
