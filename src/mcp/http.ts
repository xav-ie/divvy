import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { json } from "../api/http.ts";
import { getDb } from "../db/connection.ts";
import { userForToken } from "../services/tokens.ts";
import { createServer } from "./server.ts";

/** Failed token attempts allowed per client per window before 429s. */
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;
// ponytail: in-memory and per process; fine for one household server.
const failures = new Map<string, { count: number; until: number }>();

/** Failures for this client in the current window (expired windows reset). */
function failuresFor(client: string, now: number) {
  const f = failures.get(client);
  if (!f || f.until <= now) return { count: 0, until: now + WINDOW_MS };
  return f;
}

const unauthorized = (error: string, invalid: boolean) =>
  json({ error }, 401, {
    "www-authenticate": `Bearer realm="divvy"${invalid ? ', error="invalid_token"' : ""}`,
  });

/** A browser page on another site; assistants don't send Origin, the app's own pages send their own. */
function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/**
 * The HTTP MCP endpoint: stateless Streamable HTTP, authenticated only by
 * `Authorization: Bearer <personal access token>`, acting as its owner.
 */
export async function handleMcp(
  request: Request,
  client: string,
  now = Date.now(),
): Promise<Response> {
  if (foreignOrigin(request))
    return json({ error: "Cross-origin requests aren't allowed" }, 403);
  const tried = failuresFor(client, now);
  if (tried.count >= MAX_FAILURES)
    return json({ error: "Too many bad tokens; wait a minute" }, 429, {
      "retry-after": String(Math.ceil((tried.until - now) / 1000)),
    });
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) return unauthorized("Send Authorization: Bearer <token>", false);
  const db = getDb();
  const user = userForToken(db, token);
  if (!user) {
    failures.set(client, { ...tried, count: tried.count + 1 });
    return unauthorized("That token is invalid or revoked", true);
  }
  // Stateless: no sessions to resume (GET) or end (DELETE).
  if (request.method !== "POST")
    return json(
      { error: "This MCP server is stateless; send requests with POST" },
      405,
      { allow: "POST" },
    );
  const server = createServer({ db, user });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
