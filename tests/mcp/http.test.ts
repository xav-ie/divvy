import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { beforeAll, describe, expect, it } from "vitest";
import { apiClient } from "../api/client.ts";

let call: Awaited<ReturnType<typeof apiClient>>;
let anaToken: string;
let benToken: string;
let anaCookie: string;

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  },
};
const mcpHeaders = (token?: string, extra: Record<string, string> = {}) => ({
  headers: {
    accept: "application/json, text/event-stream",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  },
});

// Picker mode, so /mcp must also bypass the picker cookie.
beforeAll(async () => {
  call = await apiClient([], {
    DIVVY_AUTH_MODE: "picker",
    DIVVY_SESSION_SECRET: "s".repeat(32),
    DIVVY_VENMO_LOOKUP: "stub",
    DIVVY_VENMO_STUB_FOUND: "ana-pays",
    DIVVY_VENMO_STUB_MISSING: "nobody-here",
  });
  const join = async (name: string) => {
    const res = await call("POST", "/api/who", {
      body: { name, email: `${name.toLowerCase()}@example.com` },
    });
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    await call("POST", "/api/groups", {
      headers: { cookie },
      body: { name: `${name}'s place` },
    });
    const t = await call("POST", "/api/tokens", {
      headers: { cookie },
      body: { name: "Claude" },
    });
    return { cookie, token: t.body.token as string };
  };
  ({ cookie: anaCookie, token: anaToken } = await join("Ana"));
  ({ token: benToken } = await join("Ben"));
});

async function connect(token: string) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://divvy.test/mcp"), {
      fetch: call.fetch,
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

describe("HTTP MCP", () => {
  it("acts as each token's owner", async () => {
    for (const [token, name] of [
      [anaToken, "Ana's place"],
      [benToken, "Ben's place"],
    ] as const) {
      const client = await connect(token);
      const r = await client.callTool({ name: "list_groups", arguments: {} });
      const groups = (r.structuredContent as { groups: { name: string }[] })
        .groups;
      expect(groups.map((g) => g.name)).toEqual([name]);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).not.toContain("scan_receipt_file");
      await client.close();
    }
    const tokens = await call("GET", "/api/tokens", {
      headers: { cookie: anaCookie },
    });
    expect(tokens.body[0].lastUsed).not.toBe(null);
  });

  it("401s missing, wrong and revoked tokens with WWW-Authenticate", async () => {
    const missing = await call("POST", "/mcp", { body: INIT, ...mcpHeaders() });
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe(
      'Bearer realm="divvy"',
    );
    const cookieOnly = await call("POST", "/mcp", {
      body: INIT,
      ...mcpHeaders(undefined, { cookie: anaCookie }),
    });
    expect(cookieOnly.status).toBe(401);
    const wrong = await call("POST", "/mcp", {
      body: INIT,
      ...mcpHeaders(`${anaToken.slice(0, -2)}xx`, {
        "x-forwarded-for": "10.0.0.2",
      }),
    });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toMatch(
      /error="invalid_token"/,
    );

    const extra = await call("POST", "/api/tokens", {
      headers: { cookie: anaCookie },
      body: { name: "Old" },
    });
    expect(
      (
        await call("POST", "/mcp", {
          body: INIT,
          ...mcpHeaders(extra.body.token),
        })
      ).status,
    ).toBe(200);
    await call("DELETE", `/api/tokens/${extra.body.id}`, {
      headers: { cookie: anaCookie },
    });
    expect(
      (
        await call("POST", "/mcp", {
          body: INIT,
          ...mcpHeaders(extra.body.token),
        })
      ).status,
    ).toBe(401);
  });

  it("rejects other sites' browser origins and rate-limits bad tokens", async () => {
    const foreign = await call("POST", "/mcp", {
      body: INIT,
      ...mcpHeaders(anaToken, { origin: "https://evil.example" }),
    });
    expect(foreign.status).toBe(403);
    const own = await call("POST", "/mcp", {
      body: INIT,
      ...mcpHeaders(anaToken, { origin: "http://divvy.test" }),
    });
    expect(own.status).toBe(200);

    const bad = mcpHeaders("divvy_00000000_" + "a".repeat(43), {
      "x-forwarded-for": "10.9.9.9",
    });
    for (let i = 0; i < 10; i++)
      expect((await call("POST", "/mcp", { body: INIT, ...bad })).status).toBe(
        401,
      );
    expect((await call("POST", "/mcp", { body: INIT, ...bad })).status).toBe(
      429,
    );
    // Other clients are unaffected.
    expect(
      (await call("POST", "/mcp", { body: INIT, ...mcpHeaders(anaToken) }))
        .status,
    ).toBe(200);
  });

  it("is stateless: GET and DELETE are 405 for a valid token", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await call(method, "/mcp", mcpHeaders(anaToken));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
    expect((await call("GET", "/mcp", mcpHeaders())).status).toBe(401);
  });

  it("saves a Venmo username only when Venmo confirms it", async () => {
    const client = await connect(anaToken);
    const set = async (username: string) => {
      const r = await client.callTool({
        name: "set_venmo_username",
        arguments: { username },
      });
      return r.isError
        ? { error: (r.content as Array<{ text: string }>)[0]!.text }
        : r.structuredContent;
    };
    expect(await set("nobody-here")).toEqual({
      error: "We couldn't find @nobody-here on Venmo; check the spelling.",
    });
    expect(await set("cant-tell")).toEqual({
      error: "Couldn't check Venmo right now; try again in a minute.",
    });
    expect(await set("@ana-pays")).toMatchObject({
      venmo: "ana-pays",
      found: true,
      link: "https://venmo.com/ana-pays",
    });
    await client.close();
  });

  it("leaves the rest of the app behind the picker", async () => {
    expect(
      (await call("GET", "/api/groups", mcpHeaders(anaToken))).status,
    ).toBe(401);
    expect((await call("GET", "/groups", mcpHeaders(anaToken))).status).toBe(
      302,
    );
  });
});
