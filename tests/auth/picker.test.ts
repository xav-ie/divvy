import { describe, expect, it } from "vitest";
import {
  pickedUserId,
  pickerCookie,
  signUserId,
  verifyUserId,
} from "../../src/auth/picker.ts";
import { authConfig } from "../../src/config.ts";

const SECRET = "a".repeat(32);

describe("picker cookie", () => {
  it("round-trips a signed user id and rejects tampering or another secret", () => {
    const v = signUserId(7, SECRET);
    expect(verifyUserId(v, SECRET)).toBe(7);
    expect(verifyUserId(v.replace(/^7/, "8"), SECRET)).toBe(null);
    expect(verifyUserId(`${v}x`, SECRET)).toBe(null);
    expect(verifyUserId(v, "b".repeat(32))).toBe(null);
    expect(verifyUserId("7", SECRET)).toBe(null);
    expect(verifyUserId("", SECRET)).toBe(null);
  });

  it("reads the cookie and sets the right attributes", () => {
    const http = new Request("http://divvy.lan/");
    const set = pickerCookie(http, 3, SECRET);
    expect(set).toMatch(
      /^divvy_who=3\.[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=31536000$/,
    );
    const viaTraefik = new Request("http://divvy.lan/", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(pickerCookie(viaTraefik, 3, SECRET)).toMatch(/; Secure$/);
    expect(pickerCookie(http, null, SECRET)).toMatch(
      /^divvy_who=; .*Max-Age=0/,
    );
    const cookie = set.split(";")[0]!;
    const req = new Request("http://divvy.lan/", {
      headers: { cookie: `other=1; ${cookie}` },
    });
    expect(pickedUserId(req, SECRET)).toBe(3);
  });
});

describe("authConfig picker mode", () => {
  it("needs a 32 byte secret and a known mode; access stays as it was", () => {
    expect(
      authConfig({ DIVVY_AUTH_MODE: "picker", DIVVY_SESSION_SECRET: SECRET }),
    ).toEqual({ mode: "picker", secret: SECRET });
    expect(() =>
      authConfig({ DIVVY_AUTH_MODE: "picker", DIVVY_SESSION_SECRET: "short" }),
    ).toThrow(/at least 32 bytes/);
    expect(() => authConfig({ DIVVY_AUTH_MODE: "picker" })).toThrow(
      /DIVVY_SESSION_SECRET/,
    );
    expect(() => authConfig({ DIVVY_AUTH_MODE: "tailscale" })).toThrow(
      /must be "access" or "picker"/,
    );
    expect(
      authConfig({
        DIVVY_ACCESS_TEAM_DOMAIN: "house.cloudflareaccess.com",
        DIVVY_ACCESS_AUD: "aud",
      }),
    ).toEqual({
      mode: "access",
      teamDomain: "house.cloudflareaccess.com",
      aud: "aud",
    });
    expect(() => authConfig({})).toThrow(/DIVVY_ACCESS_TEAM_DOMAIN/);
  });
});
