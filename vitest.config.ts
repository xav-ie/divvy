import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./tests/worker.ts",
      // Workers AI only runs remotely; tests stub scanning instead.
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { DIVVY_VENMO_LOOKUP: "off" } },
    }),
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
