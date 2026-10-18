import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "passthrough" }),
  // No Astro sessions, so no KV namespace for them.
  session: false,
  integrations: [react()],
  // Pages load on hover/touch so navigating feels instant (ClientRouter in Layout).
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  vite: { plugins: [tailwindcss()] },
});
