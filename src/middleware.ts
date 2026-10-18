import type { MiddlewareHandler } from "astro";
import { json } from "./api/http.ts";
import { authenticator, type Authenticate } from "./auth/session.ts";
import { authConfig, type AuthConfig } from "./config.ts";
import { getDb } from "./db/connection.ts";

let cfg: AuthConfig | undefined;
let authenticate: Authenticate | undefined;

/** Reachable without a user in picker mode: the picker page, its API and built assets. */
const pickerOpen = (path: string) =>
  path === "/who" || path === "/api/who" || path.startsWith("/_astro/");

/**
 * Every route but /healthz and /mcp needs a signed-in user; it lands in `locals.ctx`.
 * Without one, API calls get 401; pages in picker mode redirect to /who.
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  const path = context.url.pathname;
  // /mcp authenticates by bearer token itself (src/mcp/http.ts).
  if (path === "/healthz" || path === "/mcp") return next();
  cfg ??= authConfig();
  authenticate ??= authenticator(cfg);
  context.locals.auth = cfg;
  if (cfg.mode === "picker" && pickerOpen(path)) return next();
  const db = getDb();
  const who = await authenticate(context.request, db);
  if (!who) {
    if (cfg.mode === "picker" && !path.startsWith("/api/"))
      return context.redirect("/who", 302);
    return json({ error: "Sign in required" }, 401);
  }
  context.locals.ctx = { db, user: who.user };
  context.locals.email = who.email;
  return next();
};
