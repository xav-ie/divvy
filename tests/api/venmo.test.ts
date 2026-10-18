import { beforeAll, describe, expect, it } from "vitest";
import { apiClient } from "./client.ts";

let call: Awaited<ReturnType<typeof apiClient>>;
beforeAll(async () => {
  // The e2e stub: one username Venmo "has", one it doesn't, the rest can't be checked.
  call = await apiClient(["ana@example.com"], {
    DIVVY_VENMO_LOOKUP: "stub",
    DIVVY_VENMO_STUB_FOUND: "ana-pays",
    DIVVY_VENMO_STUB_MISSING: "nobody-here",
  });
});

const preview = (venmo: string) =>
  call("POST", "/api/me/venmo/preview", { body: { venmo } });

describe("only verified Venmo usernames are saved", () => {
  it("rejects a save without a check, or after a check that didn't find it", async () => {
    expect(
      (await call("PATCH", "/api/me", { body: { venmo: "ana-pays" } })).body,
    ).toEqual({
      error: "Check @ana-pays on Venmo before saving it",
    });

    const missing = await preview("nobody-here");
    expect(missing.body).toMatchObject({
      found: false,
      note: "We couldn't find @nobody-here on Venmo; check the spelling.",
    });
    const r1 = await call("PATCH", "/api/me", {
      body: { venmo: "nobody-here", previewId: missing.body.previewId },
    });
    expect(r1).toEqual({
      status: 400,
      body: {
        error: "We couldn't find @nobody-here on Venmo; check the spelling.",
      },
    });

    const unknown = await preview("cant-tell");
    expect(unknown.body).toMatchObject({
      found: null,
      note: "Couldn't check Venmo right now; try again in a minute.",
    });
    const r2 = await call("PATCH", "/api/me", {
      body: { venmo: "cant-tell", previewId: unknown.body.previewId },
    });
    expect(r2.body).toEqual({
      error: "Couldn't check Venmo right now; try again in a minute.",
    });

    // A found check can't be reused for another username.
    const found = await preview("@ana-pays");
    expect(found.body).toMatchObject({ found: true, note: null });
    expect(found.body.photoUrl).toMatch(/^\/api\/me\/venmo\/preview\//);
    const r3 = await call("PATCH", "/api/me", {
      body: { venmo: "nobody-here", previewId: found.body.previewId },
    });
    expect(r3.status).toBe(400);
    expect((await call("GET", "/api/me")).body.venmo).toBe(null);
  });

  it("saves a found username with its photo, and clears without a check", async () => {
    const found = await preview("ana-pays");
    const saved = await call("PATCH", "/api/me", {
      body: { venmo: "ana-pays", previewId: found.body.previewId },
    });
    expect(saved.body).toMatchObject({
      venmo: "ana-pays",
      venmoStatus: "found",
      hasVenmoAvatar: true,
    });
    // Saving the same username again needs nothing new.
    expect(
      (await call("PATCH", "/api/me", { body: { venmo: "ana-pays" } })).status,
    ).toBe(200);
    expect(
      (await call("PATCH", "/api/me", { body: { venmo: "" } })).body.venmo,
    ).toBe(null);
  });
});
