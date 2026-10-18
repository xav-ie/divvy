import type { APIContext, APIRoute, MiddlewareHandler } from "astro";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { useDb } from "../../src/db/connection.ts";
import { migrate } from "../../src/db/migrate.ts";

/**
 * Calls API routes in-process through the real middleware, the way Astro
 * would: dev auth with the given users, inside one fresh Durable Object per
 * client. Call once per file before anything touches the database.
 */
export async function apiClient(
  users: string[],
  vars: Record<string, string> = {},
) {
  const workerVars = env as unknown as Record<string, string | undefined>;
  workerVars.DIVVY_DEV_USER = users[0];
  workerVars.DIVVY_DEV_USERS = users.join(",");
  delete workerVars.DIVVY_ACCESS_TEAM_DOMAIN;
  delete workerVars.DIVVY_ACCESS_AUD;
  delete workerVars.DIVVY_AUTH_MODE;
  Object.assign(workerVars, vars);
  const divvy = env.DIVVY.getByName(crypto.randomUUID());

  const { onRequest } = (await import("../../src/middleware.ts")) as {
    onRequest: MiddlewareHandler;
  };
  const modules = import.meta.glob<Record<string, APIRoute>>(
    "../../src/pages/**/*.ts",
    { eager: true },
  );
  const routes = Object.entries(modules).map(([file, mod]) => {
    const path = file
      .replace("../../src/pages", "")
      .replace(/\.ts$/, "")
      .replace(/\/index$/, "");
    const names: string[] = [];
    const pattern = path.replace(
      /\[(\w+)\]/g,
      (_, name: string) => (names.push(name), "([^/]+)"),
    );
    return { regex: new RegExp(`^${pattern}$`), names, mod };
  });
  // Like Astro, static segments win over parameters (/receipts/scan vs /receipts/[id]).
  routes.sort((a, b) => a.names.length - b.names.length);

  /** Run a raw request through the middleware and the matching route, like Astro. */
  /** Bodies are I/O objects bound to one Durable Object, so cross as bytes. */
  async function dispatch(request: Request): Promise<Response> {
    const body = request.body ? await request.arrayBuffer() : undefined;
    const { method, url } = request;
    const headers = [...request.headers];
    const out = await runInDurableObject(divvy, async (_, state) => {
      useDb(state.storage);
      migrate(state.storage);
      const res = await route(new Request(url, { method, headers, body }));
      return {
        status: res.status,
        headers: [...res.headers],
        body: res.body ? await res.arrayBuffer() : null,
      };
    });
    return new Response(out.body, out);
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = routes
      .map((r) => ({ r, m: r.regex.exec(url.pathname) }))
      .find((x) => x.m);
    const handler = match?.r.mod[request.method] ?? match?.r.mod.ALL;
    const params = Object.fromEntries(
      match?.r.names.map((n, i) => [n, match.m![i + 1]]) ?? [],
    );
    const context = {
      request,
      url,
      params,
      locals: {},
      redirect: (to: string, status = 302) =>
        new Response(null, { status, headers: { location: to } }),
    } as unknown as APIContext;
    const next = async () =>
      handler
        ? handler(context)
        : new Response(null, { status: match ? 405 : 404 });
    return (await onRequest(context, next)) as Response;
  }

  /** `as` picks the dev user (header); `null` sends a request with an unknown user. */
  async function call(
    method: string,
    path: string,
    opts: {
      as?: string | null;
      body?: unknown;
      form?: FormData;
      headers?: Record<string, string>;
    } = {},
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const url = new URL(path, "http://divvy.test");
    const headers: Record<string, string> = opts.form
      ? {}
      : { "content-type": "application/json" };
    if (opts.as !== undefined)
      headers["x-divvy-dev-user"] = opts.as ?? "stranger@example.com";
    Object.assign(headers, opts.headers);
    const request = new Request(url, {
      method,
      headers,
      body:
        opts.form ??
        (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    });
    const res = await dispatch(request);
    const text = await res.text();
    const out = {
      status: res.status,
      body: res.headers.get("content-type")?.includes("json")
        ? JSON.parse(text)
        : text || undefined,
    };
    // Non-enumerable so toEqual on { status, body } keeps working.
    return Object.defineProperty(out, "headers", {
      value: res.headers,
    }) as typeof out & { headers: Headers };
  }
  /** A `fetch` served in-process, for SDK clients. */
  call.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    dispatch(new Request(input, init));
  return call;
}
