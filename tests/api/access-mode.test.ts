import { beforeAll, describe, expect, it } from "vitest";
import { apiClient } from "./client.ts";

let call: Awaited<ReturnType<typeof apiClient>>;
beforeAll(async () => {
  call = await apiClient([], {
    DIVVY_ACCESS_TEAM_DOMAIN: "house.cloudflareaccess.com",
    DIVVY_ACCESS_AUD: "aud",
  });
});

describe("access mode", () => {
  it("answers 401 to pages and the API without a token, and has no picker", async () => {
    for (const path of ["/groups", "/api/me", "/who", "/api/who"]) {
      expect(await call("GET", path)).toEqual({
        status: 401,
        body: { error: "Sign in required" },
      });
    }
  });
});
