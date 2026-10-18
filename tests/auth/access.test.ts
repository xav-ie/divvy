import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { accessVerifier } from "../../src/auth/access.ts";
import { devEmail } from "../../src/auth/dev.ts";
import { authConfig } from "../../src/config.ts";

const cfg = { teamDomain: "house.cloudflareaccess.com", aud: "aud-123" };
let sign: (
  claims: Record<string, unknown>,
  opts?: { kid?: string; exp?: string; iss?: string; aud?: string },
) => Promise<string>;
let verify: (token: string) => Promise<string>;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  verify = accessVerifier(cfg, createLocalJWKSet({ keys: [jwk] }));
  sign = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? "k1" })
      .setIssuer(opts.iss ?? `https://${cfg.teamDomain}`)
      .setAudience(opts.aud ?? cfg.aud)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? "5m")
      .sign(privateKey);
});

describe("accessVerifier", () => {
  it("accepts a valid token and returns the email", async () => {
    expect(await verify(await sign({ email: "Ana@Example.com" }))).toBe(
      "ana@example.com",
    );
  });

  it("rejects wrong audience, issuer, expired, unknown key and missing email", async () => {
    await expect(
      verify(await sign({ email: "a@b.c" }, { aud: "other" })),
    ).rejects.toThrow();
    await expect(
      verify(await sign({ email: "a@b.c" }, { iss: "https://evil.example" })),
    ).rejects.toThrow();
    await expect(
      verify(await sign({ email: "a@b.c" }, { exp: "-1m" })),
    ).rejects.toThrow();
    await expect(
      verify(await sign({ email: "a@b.c" }, { kid: "k2" })),
    ).rejects.toThrow();
    await expect(verify(await sign({}))).rejects.toThrow();
    await expect(verify("not.a.jwt")).rejects.toThrow();
  });

  it("rejects a token signed by another key", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const forged = await new SignJWT({ email: "a@b.c" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://${cfg.teamDomain}`)
      .setAudience(cfg.aud)
      .setExpirationTime("5m")
      .sign(privateKey);
    await expect(verify(forged)).rejects.toThrow();
  });
});

describe("config and dev users", () => {
  it("refuses to run without Access or a dev user", () => {
    expect(() => authConfig({})).toThrow(/DIVVY_DEV_USER/);
    expect(
      authConfig({
        DIVVY_ACCESS_TEAM_DOMAIN: "https://house.cloudflareaccess.com/",
        DIVVY_ACCESS_AUD: "x",
      }),
    ).toEqual({
      mode: "access",
      teamDomain: "house.cloudflareaccess.com",
      aud: "x",
    });
  });

  it("picks dev users by header", () => {
    const dev = authConfig({
      DIVVY_DEV_USER: "me@example.com",
      DIVVY_DEV_USERS: "ana@example.com, ben@example.com",
    });
    if (dev.mode !== "dev") throw new Error("expected dev mode");
    const req = (h?: string) =>
      new Request("http://x/", { headers: h ? { "x-divvy-dev-user": h } : {} });
    expect(devEmail(dev, req())).toBe("me@example.com");
    expect(devEmail(dev, req("Ben@example.com"))).toBe("ben@example.com");
    expect(devEmail(dev, req("eve@example.com"))).toBeNull();
  });
});
