import { handle } from "@astrojs/cloudflare/handler";
import { DurableObject } from "cloudflare:workers";
import { useDb } from "./db/connection.ts";
import { migrate } from "./db/migrate.ts";
import { billDue } from "./services/recurring.ts";

/**
 * The whole app runs inside one Durable Object, so every request shares its
 * SQLite database and `transactionSync` keeps multi-step writes atomic. A
 * household's traffic fits one instance many times over.
 */
export class Divvy extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    useDb(ctx.storage);
    migrate(ctx.storage);
  }

  override fetch(request: Request): Promise<Response> {
    return handle(request, this.env, this.ctx as unknown as ExecutionContext);
  }

  /** Bill fixed recurring templates whose day has come this month. */
  recur(): void {
    const { billed, skipped, failed } = billDue(this.ctx.storage);
    for (const b of billed)
      console.log(`Billed "${b.title}" as expense ${b.expenseId}`);
    for (const s of skipped)
      console.log(`Skipped "${s.title}": already expense ${s.expenseId}`);
    for (const f of failed)
      console.error(
        `Couldn't bill "${f.title}" (recurring ${f.recurringId}): ${f.error}`,
      );
  }
}

const divvy = (env: Env) => env.DIVVY.getByName("divvy");

export default {
  fetch: (request, env) => divvy(env).fetch(request),
  async scheduled(_controller, env) {
    await divvy(env).recur();
  },
} satisfies ExportedHandler<Env>;
