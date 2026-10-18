import { DurableObject } from "cloudflare:workers";

/** Test stand-in for src/worker.ts's Divvy: storage only, no Astro. */
export class Divvy extends DurableObject<Env> {}

export default { fetch: () => new Response(null, { status: 404 }) };
