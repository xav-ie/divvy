import { describe, expect, it } from "vitest";
import { ServiceError } from "../../src/services/errors.ts";
import {
  createToken,
  listTokens,
  revokeToken,
  userForToken,
} from "../../src/services/tokens.ts";
import { setup } from "../helpers.ts";
import { one } from "../../src/db/rows.ts";

describe("personal access tokens", () => {
  it("creates, lists without secrets, authenticates and revokes", () =>
    setup(async ({ db, as }) => {
      const ana = as("ana@example.com");
      const ben = as("ben@example.com");
      const t = createToken(ana, { name: "Claude laptop" });
      expect(t.token).toMatch(/^divvy_[0-9a-f]{8}_[\w-]{43}$/);
      expect(t.prefix).toBe(t.token.slice(0, 14));

      // Only the hash is stored.
      const row = one(db, "SELECT * FROM api_tokens") as Record<
        string,
        unknown
      >;
      expect(Object.values(row)).not.toContain(t.token);
      expect(JSON.stringify(row)).not.toContain(t.token.slice(15));
      expect(listTokens(ana)).toEqual([
        expect.objectContaining({
          id: t.id,
          name: "Claude laptop",
          lastUsed: null,
        }),
      ]);
      expect(JSON.stringify(listTokens(ana))).not.toContain(t.token.slice(15));
      expect(listTokens(ben)).toEqual([]);

      expect(userForToken(db, t.token)?.id).toBe(ana.user.id);
      expect(listTokens(ana)[0]!.lastUsed).not.toBe(null);
      expect(userForToken(db, `${t.token.slice(0, -1)}x`)).toBe(null);
      expect(userForToken(db, "nonsense")).toBe(null);

      expect(() => revokeToken(ben, t.id)).toThrow(ServiceError);
      revokeToken(ana, t.id);
      expect(userForToken(db, t.token)).toBe(null);
      expect(listTokens(ana)[0]!.revoked).not.toBe(null);
      expect(() => createToken(ana, { name: "" })).toThrow(
        "name: Name can't be empty",
      );
    }));
});
