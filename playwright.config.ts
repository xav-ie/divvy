import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { devUserEmails } from "./e2e/people.ts";

const PORT = Number(process.env.DIVVY_E2E_PORT ?? 4399);
/** A second server in picker auth mode, for e2e/picker.spec.ts. */
const PICKER_PORT = PORT + 1;
const PICKER = "picker.spec.ts";
/** Venmo usernames the e2e servers' stub lookup "finds". */
const VENMO_FOUND = "ana-pays,rosalind-fairfax-pays";
// Workers inherit the environment, so they all see the same fresh directory.
process.env.DIVVY_E2E_DIR ??= mkdtempSync(join(tmpdir(), "divvy-e2e-"));

/**
 * The built Worker under `wrangler dev`, local only (no Workers AI), with its
 * own storage. Venmo lookups never reach the real site: the stub "finds"
 * VENMO_FOUND, says "wrong-name" doesn't exist, and can't check any other.
 */
const dev = (port: number, dir: string, vars: Record<string, string>) =>
  [
    "npx wrangler dev --local --ip 127.0.0.1",
    `--port ${port} --inspector-port ${port + 1000}`,
    `--persist-to ${join(process.env.DIVVY_E2E_DIR!, dir)}`,
    ...Object.entries({
      ...vars,
      DIVVY_VENMO_LOOKUP: "stub",
      DIVVY_VENMO_STUB_FOUND: VENMO_FOUND,
      DIVVY_VENMO_STUB_MISSING: "wrong-name",
    }).map(([k, v]) => `--var ${k}:${v}`),
  ].join(" ");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  outputDir: "e2e-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    video: "on",
    trace: "on",
  },
  projects: [
    { name: "phone", testIgnore: PICKER, use: { ...devices["Pixel 7"] } },
    {
      name: "desktop",
      testIgnore: PICKER,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1400, height: 900 },
      },
    },
    {
      name: "picker-phone",
      testMatch: PICKER,
      use: {
        ...devices["Pixel 7"],
        baseURL: `http://127.0.0.1:${PICKER_PORT}`,
      },
    },
    {
      name: "picker-desktop",
      testMatch: PICKER,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1400, height: 900 },
        baseURL: `http://127.0.0.1:${PICKER_PORT}`,
      },
    },
  ],
  // Started in order: the first builds, the second reuses that build.
  webServer: [
    {
      command: `npm run build && ${dev(PORT, "data", {
        DIVVY_DEV_USER: "owner@e2e.test",
        DIVVY_DEV_USERS: devUserEmails().join(","),
      })}`,
      url: `http://127.0.0.1:${PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { ASTRO_TELEMETRY_DISABLED: "1" },
    },
    {
      command: dev(PICKER_PORT, "picker", {
        DIVVY_AUTH_MODE: "picker",
        DIVVY_SESSION_SECRET: "e2e-picker-secret-at-least-32-bytes",
      }),
      url: `http://127.0.0.1:${PICKER_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
