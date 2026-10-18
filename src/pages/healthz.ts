import type { APIRoute } from "astro";

/** Liveness probe; the only route without auth. */
export const GET: APIRoute = () => new Response("ok");
