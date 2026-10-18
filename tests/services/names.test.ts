import { describe, expect, it } from "vitest";
import { createGroup } from "../../src/services/groups.ts";
import { addMember } from "../../src/services/members.ts";
import { signIn, updateProfile } from "../../src/services/users.ts";
import { setup } from "../helpers.ts";
import { run } from "../../src/db/rows.ts";

describe("names", () => {
  it("capitalizes the email's local part for new people", () =>
    setup(async ({ db, as }) => {
      expect(signIn(db, "xavier@example.com").name).toBe("Xavier");
      const ana = as("ana@example.com");
      const g = createGroup(ana, { name: "House" });
      expect(addMember(ana, g.id, { email: "eli@example.com" }).name).toBe(
        "Eli",
      );
      expect(signIn(db, "eli@example.com").name).toBe("Eli");
    }));

  it("keeps the placeholder's name when its person first signs in", () =>
    setup(async ({ db, as }) => {
      const ana = as("ana@example.com");
      await updateProfile(ana, { name: "Ana Ruiz" });
      const g = createGroup(ana, { name: "House" });
      addMember(ana, g.id, { name: "Benny", email: "ben.smith@example.com" });
      expect(signIn(db, "ben.smith@example.com").name).toBe("Benny");
    }));
});

describe("name length", () => {
  it("caps user, member and group names at 40 characters", () =>
    setup(async ({ db, as }) => {
      const { ServiceError } = await import("../../src/services/errors.ts");
      const ana = as("ana@example.com");
      const long = "x".repeat(41);
      const err = new ServiceError(
        400,
        "name: Names can be at most 40 characters",
      );
      expect(() => createGroup(ana, { name: long })).toThrow(err);
      await expect(updateProfile(ana, { name: long })).rejects.toThrow(err);
      const g = createGroup(ana, { name: "x".repeat(40) });
      expect(() => addMember(ana, g.id, { name: long })).toThrow(err);
      expect(signIn(db, `${"y".repeat(60)}@example.com`).name).toHaveLength(40);
      expect(() =>
        run(db, "UPDATE groups SET name = ? WHERE id = ?", long, g.id),
      ).toThrow(/CHECK constraint/);
    }));
});
