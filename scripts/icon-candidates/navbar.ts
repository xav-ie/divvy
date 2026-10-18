// Preview of the piggy in the app UI (navbar brand, empty states, 404):
//   nix develop --command bash -c "npm run build && node scripts/icon-candidates/navbar.ts"
// Starts a throwaway server itself, like playwright.config.ts does.
import { spawn } from "node:child_process";
import { chromium, devices } from "@playwright/test";

const PORT = 4891;
const env = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: String(PORT),
  DIVVY_DATA_DIR: "/tmp/divvy-icon-preview-data",
  DIVVY_DEV_USER: "owner@e2e.test",
  DIVVY_DEV_USERS: "owner@e2e.test",
  DIVVY_VENMO_LOOKUP: "stub",
  ASTRO_TELEMETRY_DISABLED: "1",
};
const server = spawn("node", ["src/cli/main.ts", "serve"], {
  env,
  stdio: "ignore",
});
let up = await fetch(`http://127.0.0.1:${PORT}/healthz`).catch(() => null);
if (!up) {
  // healthz isn't up instantly; poll for a few seconds.
  for (let i = 0; i < 50 && !up; i++) {
    await new Promise((r) => setTimeout(r, 200));
    up = await fetch(`http://127.0.0.1:${PORT}/healthz`).catch(() => null);
  }
}

const browser = await chromium.launch();
const shots: Array<{
  name: string;
  url: string;
  device: Record<string, unknown>;
}> = [
  { name: "phone-home", url: "/", device: devices["Pixel 7"] },
  {
    name: "desktop-home",
    url: "/",
    device: { viewport: { width: 1400, height: 900 } },
  },
  { name: "phone-404", url: "/nope", device: devices["Pixel 7"] },
];
for (const { name, url, device } of shots) {
  const ctx = await browser.newContext({
    ...device,
    baseURL: `http://127.0.0.1:${PORT}`,
    extraHTTPHeaders: { "x-divvy-dev-user": "owner@e2e.test" },
  });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.screenshot({
    path: `/tmp/divvy-icons/${name}.png`,
    fullPage: name === "phone-404",
  });
  await ctx.close();
  console.log(`wrote /tmp/divvy-icons/${name}.png`);
}
await browser.close();
server.kill("SIGTERM");
