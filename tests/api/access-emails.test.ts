import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client.ts";

const TEAM = "house.cloudflareaccess.com";
const AUD = "aud-123";
let call: Awaited<ReturnType<typeof apiClient>>;
let jwt: (email: string) => Promise<string>;

// Access mode for real: tokens signed by a local key served as the team's JWKS.
beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input) === `https://${TEAM}/cdn-cgi/access/certs`
      ? Promise.resolve(Response.json({ keys: [jwk] }))
      : realFetch(input, init),
  );
  jwt = (email) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(`https://${TEAM}`)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  call = await apiClient([], {
    DIVVY_ACCESS_TEAM_DOMAIN: TEAM,
    DIVVY_ACCESS_AUD: AUD,
  });
});

const as = async (email: string) => ({
  headers: { "cf-access-jwt-assertion": await jwt(email) },
});

describe("Access sign-in with several emails", () => {
  it("accepts the header or the CF_Authorization cookie, not forgeries", async () => {
    expect(
      (await call("GET", "/api/me", await as("ana@work.com"))).body.email,
    ).toBe("ana@work.com");
    const viaCookie = await call("GET", "/api/me", {
      headers: { cookie: `x=1; CF_Authorization=${await jwt("ana@work.com")}` },
    });
    expect(viaCookie.status).toBe(200);
    // Swap the payload for another email's, keeping Ana's signature.
    const [h, , sig] = (await jwt("ana@work.com")).split(".");
    const [, payload] = (await jwt("eve@evil.com")).split(".");
    const forged = `${h}.${payload}.${sig}`;
    expect(
      (
        await call("GET", "/api/me", {
          headers: { "cf-access-jwt-assertion": forged },
        })
      ).status,
    ).toBe(401);
    expect((await call("GET", "/healthz")).status).toBe(200);
    expect((await call("POST", "/mcp", { body: {} })).status).toBe(401);
  });

  it("serves /mcp to a bearer token with no Access JWT (the local path)", async () => {
    const t = await call("POST", "/api/tokens", {
      ...(await as("ana@work.com")),
      body: { name: "executor" },
    });
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "0" },
      },
    };
    const r = await call("POST", "/mcp", {
      body: init,
      headers: {
        authorization: `Bearer ${t.body.token}`,
        accept: "application/json, text/event-stream",
      },
    });
    expect(r.status).toBe(200);
  });

  it("links a second email so its JWT resolves to the same account", async () => {
    const ana = await as("ana@work.com");
    const me = (await call("GET", "/api/me", ana)).body;
    await call("POST", "/api/groups", { ...ana, body: { name: "House" } });
    const link = await call("POST", "/api/me/emails/link", ana);
    expect(link.body.path).toMatch(/^\/link\/[\w-]+$/);

    // Ana opens the link while signed in as her other email (an empty account is made on that first request).
    const home = await as("ana@home.com");
    expect((await call("GET", "/api/me", home)).body.id).not.toBe(me.id);
    const used = await call("POST", `/api${link.body.path}`, home);
    expect(used.body).toEqual({
      email: "ana@home.com",
      name: me.name,
      merged: true,
    });

    const after = await call("GET", "/api/me", home);
    expect(after.body.id).toBe(me.id);
    const groups = await call("GET", "/api/groups", home);
    expect(groups.body.map((g: { name: string }) => g.name)).toEqual(["House"]);
    expect((await call("GET", "/api/me/emails", ana)).body).toMatchObject({
      canLink: true,
      emails: [
        { email: "ana@work.com", primary: true },
        { email: "ana@home.com", primary: false },
      ],
    });
    expect((await call("POST", `/api${link.body.path}`, home)).status).toBe(
      400,
    );
  });

  it("refuses to swallow an account that has its own groups", async () => {
    const ana = await as("ana@work.com");
    const ben = await as("ben@example.com");
    await call("POST", "/api/groups", { ...ben, body: { name: "Ben's" } });
    const link = await call("POST", "/api/me/emails/link", ana);
    const r = await call("POST", `/api${link.body.path}`, ben);
    expect(r.status).toBe(409);
    expect((await call("GET", "/api/me", ben)).body.email).toBe(
      "ben@example.com",
    );
  });
});
