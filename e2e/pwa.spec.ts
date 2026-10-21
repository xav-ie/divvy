import { readFileSync } from "node:fs";
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
    display: "fullscreen",
    background_color: "#f6f6f4",
  });
  // Without theme_color, Android Chrome (156+) leaves the navigation bar to the system light/dark theme.
  expect(manifest).not.toHaveProperty("theme_color");
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

/** Stand in for Chrome's install prompt, which headless browsers never fire. */
const fakeInstallPrompt = () => {
  const e = new Event("beforeinstallprompt") as Event & {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = async () => {
    (window as { prompted?: boolean }).prompted = true;
  };
  e.userChoice = Promise.resolve({ outcome: "accepted" });
  dispatchEvent(e);
};

test("Home offers to install when the browser can, and remembers Not now", async ({
  as,
}) => {
  const ana = await as("Ana");
  const page = await ana.page();
  await page.goto("/");
  const banner = page.getByTestId("install-banner");
  await expect(banner).toHaveCount(0);

  await page.evaluate(fakeInstallPrompt);
  await expect(banner).toContainText("Install divvy");
  await banner.getByRole("button", { name: "Install" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as { prompted?: boolean }).prompted),
    )
    .toBe(true);
  await expect(banner).toHaveCount(0);

  await page.evaluate(fakeInstallPrompt);
  await banner.getByRole("button", { name: "Not now" }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await page.evaluate(fakeInstallPrompt);
  await expect(banner).toHaveCount(0);

  // Profile still has the button.
  await page.goto("/profile");
  await page.evaluate(fakeInstallPrompt);
  await page.getByRole("button", { name: "Install", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as { prompted?: boolean }).prompted),
    )
    .toBe(true);
});

test("Profile turns notifications on for this device and picks which ones", async ({
  as,
}) => {
  const ana = await as("Ana");
  const page = await ana.page();
  // Headless Chromium denies notifications and has no push service; pretend both work.
  await page.addInitScript(() => {
    let permission: NotificationPermission = "default";
    Object.defineProperty(Notification, "permission", {
      get: () => permission,
    });
    Notification.requestPermission = async () => (permission = "granted");
    // Kept across reloads, like a real subscription.
    const KEY = "fake-push";
    const json = {
      endpoint: "https://push.example.com/ana",
      keys: {
        p256dh:
          "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
    };
    const sub = {
      endpoint: json.endpoint,
      toJSON: () => json,
      unsubscribe: async () => {
        sessionStorage.removeItem(KEY);
        return true;
      },
    } as unknown as PushSubscription;
    PushManager.prototype.getSubscription = async () =>
      sessionStorage.getItem(KEY) ? sub : null;
    PushManager.prototype.subscribe = async () => {
      sessionStorage.setItem(KEY, "1");
      return sub;
    };
  });
  await page.goto("/profile");

  const device = page.getByRole("switch", {
    name: /Notifications on this device/,
  });
  await expect(device).toBeEnabled();
  await expect(device).not.toBeChecked();
  const saved = page.waitForRequest(
    (r) => r.url().endsWith("/api/push/subscriptions") && r.method() === "POST",
  );
  // It flips once the device is subscribed.
  await device.click();
  await expect(device).toBeChecked();
  expect((await saved).postDataJSON()).toMatchObject({
    endpoint: "https://push.example.com/ana",
  });
  await expect(page.getByRole("status")).toContainText(
    "Notifications are on for this device",
  );

  const payments = page.getByRole("switch", { name: /Payments/ });
  await expect(payments).toBeChecked();
  await payments.uncheck();
  await expect
    .poll(async () => (await (await ana.api.get("/api/push")).json()).payments)
    .toBe(false);
  await page.reload();
  await expect(
    page.getByRole("switch", { name: /Payments/ }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("switch", { name: /New expenses/ }),
  ).toBeChecked();

  const removed = page.waitForRequest(
    (r) =>
      r.url().includes("/api/push/subscriptions?endpoint=") &&
      r.method() === "DELETE",
  );
  const again = page.getByRole("switch", {
    name: /Notifications on this device/,
  });
  await expect(again).toBeChecked();
  await again.click();
  await removed;
  await expect(again).not.toBeChecked();
});

test("Profile shows the version and offers an update once a newer one is deployed", async ({
  as,
}) => {
  const { version } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  const ana = await as("Ana");
  const page = await ana.page();
  await page.goto("/profile");
  await expect(page.getByTestId("app-version")).toHaveText(
    `Version ${version}`,
  );
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByRole("status")).toContainText(
    "You're on the latest version",
  );

  await page.route("**/api/config", (r) =>
    r.fulfill({ json: { scan: false, version: "99.0.0" } }),
  );
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByText("Version 99.0.0 is available.")).toBeVisible();
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Update to 99.0.0" }).click();
  await reloaded;
});
