import { describe, expect, it } from "vitest";
import { getUser } from "../../src/db/users.ts";
import {
  createLinkCode,
  listEmails,
  makePrimary,
  peekLink,
  removeEmail,
  useLink,
} from "../../src/services/emails.ts";
import { ServiceError } from "../../src/services/errors.ts";
import { createGroup, listGroups } from "../../src/services/groups.ts";
import { createToken } from "../../src/services/tokens.ts";
import { signIn } from "../../src/services/users.ts";
import { setup } from "../helpers.ts";

const err = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    if (e instanceof ServiceError) return `${e.status} ${e.message}`;
    throw e;
  }
};

describe("sign-in emails", () => {
  it("links a new email to the code owner so it signs in as them", () =>
    setup(async ({ db, as }) => {
      const ana = as("ana@work.com");
      createGroup(ana, { name: "House" });
      const { code, path } = createLinkCode(ana, "access");
      expect(path).toBe(`/link/${code}`);
      expect(peekLink(db, code).ownerName).toBe("Ana");

      const r = useLink(db, code, "Ana@Home.com", "access");
      expect(r).toMatchObject({ email: "ana@home.com", merged: false });
      expect(signIn(db, "ana@home.com").id).toBe(ana.user.id);
      expect(
        listEmails(ana, "access").emails.map((e) => [e.email, e.primary]),
      ).toEqual([
        ["ana@work.com", true],
        ["ana@home.com", false],
      ]);
      // Single use.
      expect(err(() => useLink(db, code, "x@y.com", "access"))).toBe(
        "400 This link was already used. Make a new one in Profile.",
      );
    }));

  it("merges an empty auto-created account and refuses one with data", () =>
    setup(async ({ db, as }) => {
      const ana = as("ana@work.com");
      const blank = signIn(db, "ana@phone.com");
      const merged = useLink(
        db,
        createLinkCode(ana, "access").code,
        "ana@phone.com",
        "access",
      );
      expect(merged.merged).toBe(true);
      expect(getUser(db, blank.id)).toBe(undefined);
      expect(signIn(db, "ana@phone.com").id).toBe(ana.user.id);

      const ben = as("ben@example.com");
      createGroup(ben, { name: "Ben's" });
      expect(
        err(() =>
          useLink(
            db,
            createLinkCode(ana, "access").code,
            "ben@example.com",
            "access",
          ),
        ),
      ).toMatch(/^409 ben@example.com already has its own divvy account/);
      const cy = as("cy@example.com");
      createToken(cy, { name: "t" });
      expect(
        err(() =>
          useLink(
            db,
            createLinkCode(ana, "access").code,
            "cy@example.com",
            "access",
          ),
        ),
      ).toMatch(/^409 /);
      expect(
        listGroups({ db, user: signIn(db, "ben@example.com") }).map(
          (g) => g.name,
        ),
      ).toEqual(["Ben's"]);
    }));

  it("rejects tampered, expired and non-Access links", () =>
    setup(async ({ db, as }) => {
      const ana = as("ana@work.com");
      const now = Date.parse("2026-10-13T12:00:00Z");
      const { code } = createLinkCode(ana, "access", now);
      expect(err(() => useLink(db, `${code}x`, "a@b.com", "access", now))).toBe(
        "400 This link isn't valid. Make a new one in Profile.",
      );
      expect(
        err(() => useLink(db, code, "a@b.com", "access", now + 16 * 60_000)),
      ).toBe("400 This link expired. Make a new one in Profile.");
      expect(err(() => createLinkCode(ana, "picker"))).toMatch(
        /^400 Adding sign-in emails is available with Cloudflare sign-in/,
      );
      expect(err(() => useLink(db, code, "a@b.com", "dev", now))).toMatch(
        /^400 Adding sign-in emails/,
      );
      // Still usable within the window.
      expect(
        useLink(db, code, "a@b.com", "access", now + 14 * 60_000).user.id,
      ).toBe(ana.user.id);
    }));

  it("removes non-primary emails and switches the primary", () =>
    setup(async ({ db, as }) => {
      const ana = as("ana@work.com");
      useLink(db, createLinkCode(ana, "access").code, "ana@home.com", "access");
      const [work, home] = listEmails(ana, "access").emails.map((e) => e);
      if (!work || !home) throw new Error("expected two emails");
      expect(err(() => removeEmail(ana, work.id))).toBe(
        "403 Choose another primary email before removing this one",
      );
      expect(makePrimary(ana, home.id)[0]).toMatchObject({
        email: "ana@home.com",
        primary: true,
      });
      expect(getUser(db, ana.user.id)!.email).toBe("ana@home.com");
      removeEmail(ana, work.id);
      expect(signIn(db, "ana@work.com").id).not.toBe(ana.user.id);
      const ben = as("ben@example.com");
      expect(err(() => removeEmail(ben, home.id))).toBe("404 Email not found");
    }));
});
