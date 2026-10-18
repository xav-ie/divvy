import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createGroup } from "../../src/services/groups.ts";
import { addMember } from "../../src/services/members.ts";
import { updateProfile } from "../../src/services/users.ts";
import {
  lookupVenmo,
  MAX_VENMO_PHOTO_BYTES,
  readVenmoAvatar,
  refreshVenmoPhoto,
} from "../../src/services/venmoProfile.ts";
import { setup, verifiedVenmo } from "../helpers.ts";
import { getUser, setVenmo } from "../../src/db/users.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const page = (
  user: string,
  image = "https://pics-v3.venmo.com/abc?width=460&amp;height=460",
) =>
  `<html><head><meta property="og:title" content="Venmo | @${user}"/>` +
  `<meta property="og:image" content="${image}"/></head></html>`;

/** A fetch that answers from a table of URL prefix -> response, recording calls. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.keys(routes).find((k) => url.startsWith(k));
    if (!hit) throw new Error(`unexpected ${url}`);
    return routes[hit]!();
  }) as typeof fetch;
  return { f, calls };
}

describe("lookupVenmo", () => {
  it("finds the profile and copies its og:image from Venmo's picture host", async () => {
    const { f, calls } = fakeFetch({
      "https://account.venmo.com/u/Ana-Pays": () =>
        new Response(page("Ana-Pays")),
      "https://pics-v3.venmo.com/": () => new Response(JPEG),
    });
    const r = await lookupVenmo("Ana-Pays", f);
    expect(r).toEqual({
      status: "found",
      photo: { bytes: JPEG, mime: "image/jpeg" },
    });
    expect(calls[1]).toBe("https://pics-v3.venmo.com/abc?width=460&height=460");
  });

  it("reports missing users, walls and timeouts, and refuses bad photos", async () => {
    const missing = fakeFetch({
      "https://account": () => new Response("", { status: 404 }),
    });
    expect(await lookupVenmo("nobody-here", missing.f)).toEqual({
      status: "not_found",
    });

    const wall = fakeFetch({
      "https://account": () => new Response("<title>Just a moment</title>"),
    });
    expect(await lookupVenmo("ana-pays", wall.f)).toEqual({
      status: "unavailable",
    });

    const down = fakeFetch({
      "https://account": () => new Response("", { status: 503 }),
    });
    expect(await lookupVenmo("ana-pays", down.f)).toEqual({
      status: "unavailable",
    });

    const boom = (async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as typeof fetch;
    expect(await lookupVenmo("ana-pays", boom)).toEqual({
      status: "unavailable",
    });

    for (const body of [
      new Uint8Array(MAX_VENMO_PHOTO_BYTES + 1).fill(0xff),
      new TextEncoder().encode("<svg onload=alert(1)>"),
    ]) {
      const bad = fakeFetch({
        "https://account": () => new Response(page("ana-pays")),
        "https://pics-v3.venmo.com/": () => new Response(body),
      });
      expect(await lookupVenmo("ana-pays", bad.f)).toEqual({ status: "found" });
    }

    // An og:image somewhere else is never fetched.
    const elsewhere = fakeFetch({
      "https://account": () =>
        new Response(page("ana-pays", "https://evil.example/x.jpg")),
    });
    expect(await lookupVenmo("ana-pays", elsewhere.f)).toEqual({
      status: "found",
    });
    expect(elsewhere.calls).toHaveLength(1);
  });
});

describe("stored Venmo photos", () => {
  it("are kept on save and served to people who share a group", () =>
    setup(async ({ as }) => {
      const ana = as("ana@example.com");
      const ben = as("ben@example.com");
      const eve = as("eve@example.com");
      const g = createGroup(ana, { name: "House" });
      addMember(ana, g.id, { email: "ben@example.com" });

      verifiedVenmo(ana, "ana-pays");
      const u = await refreshVenmoPhoto(ana, async () => ({
        status: "found",
        photo: { bytes: JPEG, mime: "image/jpeg" },
      }));
      expect(u).toMatchObject({ venmoStatus: "found", hasVenmoAvatar: true });
      expect((await readVenmoAvatar(ben, ana.user.id)).bytes).toEqual(JPEG);
      await expect(readVenmoAvatar(eve, ana.user.id)).rejects.toThrow(
        "Photo not found",
      );

      // A different username forgets the old photo until looked up again.
      setVenmo(ana.db, ana.user.id, "ana-new");
      expect(getUser(ana.db, ana.user.id)).toMatchObject({
        venmoStatus: null,
        hasVenmoAvatar: false,
      });
      const gone = await refreshVenmoPhoto(ana, async () => ({
        status: "not_found",
      }));
      expect(gone).toMatchObject({
        venmoStatus: "not_found",
        hasVenmoAvatar: false,
      });
    }));
});

describe("preview before saving", () => {
  it("saves nothing until confirmed, then keeps the photo", () =>
    setup(async ({ as, db }) => {
      const { previewVenmo, readPreviewPhoto } =
        await import("../../src/services/venmoProfile.ts");
      const stored = async (prefix: string) =>
        (await env.FILES.list({ prefix })).objects.map((o) => o.key);
      const ana = as("ana@example.com");
      const ben = as("ben@example.com");
      const found = async () => ({
        status: "found" as const,
        photo: { bytes: JPEG, mime: "image/jpeg" },
      });

      const p = await previewVenmo(ana, { venmo: "@Ana-Pays" }, found);
      expect(p).toMatchObject({
        username: "Ana-Pays",
        link: "https://venmo.com/Ana-Pays",
        photoUrl: `/api/me/venmo/preview/${p.previewId}`,
        found: true,
        note: null,
      });
      // Nothing saved yet; the photo is only for Ana.
      expect(getUser(db, ana.user.id)).toMatchObject({
        venmo: null,
        hasVenmoAvatar: false,
      });
      expect((await readPreviewPhoto(ana, p.previewId)).bytes).toEqual(JPEG);
      await expect(readPreviewPhoto(ben, p.previewId)).rejects.toThrow(
        "Photo not found",
      );

      // "Edit": a preview never confirmed changes nothing; Ben can't use Ana's.
      await expect(
        updateProfile(ben, { venmo: "Ana-Pays", previewId: p.previewId }),
      ).rejects.toThrow("Check @Ana-Pays on Venmo before saving it");
      expect(getUser(db, ben.user.id)!.venmo).toBe(null);

      // "Yes, save": the found preview saves the username and keeps its photo.
      expect(
        await updateProfile(ana, { venmo: "Ana-Pays", previewId: p.previewId }),
      ).toMatchObject({
        venmo: "Ana-Pays",
        venmoStatus: "found",
        hasVenmoAvatar: true,
      });
      expect((await readVenmoAvatar(ana, ana.user.id)).bytes).toEqual(JPEG);
      expect(await stored(`venmo-previews/${p.previewId}`)).toEqual([]);

      // A preview only saves the username it checked.
      const other = await previewVenmo(ana, { venmo: "someone-else" }, found);
      await expect(
        updateProfile(ana, {
          venmo: "another-one",
          previewId: other.previewId,
        }),
      ).rejects.toThrow("Check @another-one on Venmo before saving it");

      // Not found and unavailable read as such; stale previews are swept after an hour.
      const missing = await previewVenmo(
        ana,
        { venmo: "nobody-here" },
        async () => ({
          status: "not_found" as const,
        }),
      );
      expect(missing).toMatchObject({
        found: false,
        photoUrl: null,
        note: "We couldn't find @nobody-here on Venmo; check the spelling.",
      });
      await previewVenmo(
        ana,
        { venmo: "later-one" },
        found,
        Date.now() + 2 * 60 * 60 * 1000,
      );
      expect(await stored(`venmo-previews/${missing.previewId}`)).toEqual([]);
      // With lookups off (as in tests) nothing is confirmed, so nothing can be saved.
      const off = await previewVenmo(ana, { venmo: "someone-real" });
      expect(off).toMatchObject({
        found: null,
        note: "Couldn't check Venmo right now; try again in a minute.",
      });
      await expect(previewVenmo(ana, { venmo: "" }, found)).rejects.toThrow(
        "Enter a Venmo username",
      );
    }));
});
