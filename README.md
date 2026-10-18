<p align="center">
  <img src="public/favicon.svg" alt="divvy" width="128" height="128">
</p>

<h1 align="center">divvy</h1>

<p align="center">Split bills with the people you live with.</p>

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/xav-ie/divvy"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>
</p>

Bill splitting for a household, running entirely on Cloudflare: a Worker, one
SQLite Durable Object, R2 for receipts and attachments, Workers AI for receipt
scanning, and Cloudflare Access for sign-in. See [SPEC.md](SPEC.md) for the
product spec; it is the source of truth.

## Deploy your own

1. Click **Deploy to Cloudflare** above. Cloudflare copies this repository
   into your GitHub account, creates the R2 bucket and Durable Object, and
   builds and deploys the Worker. It asks for two settings,
   `DIVVY_ACCESS_TEAM_DOMAIN` and `DIVVY_ACCESS_AUD`; enter your team domain
   (Zero Trust > Settings > Team domain, e.g. `yourteam.cloudflareaccess.com`)
   and any placeholder for the AUD for now.
2. Put Cloudflare Access in front of the Worker: Workers & Pages > your
   Worker > Access, require sign-in on all traffic, and allow the emails of
   the people in your household. (Zero Trust must be on for the account; a
   custom domain with its own Access application works too.)
3. Copy that Access application's Application Audience (AUD) Tag (Zero
   Trust > Access > Applications, open it) into the Worker's
   `DIVVY_ACCESS_AUD` secret (Worker > Settings > Variables and Secrets),
   then open the app and sign in.

Everyone who signs in through Access gets an account; invite roommates by
adding them to a group with their email. A household fits within the free
plans (Durable Object storage, 10 GB of R2, and Workers AI's daily free
allocation covers dozens of receipt scans a day).

The Durable Object keeps 30 days of point-in-time recovery, so there is no
separate backup job.

## Develop

```sh
nix develop          # node 24 + playwright browsers (or any node >= 22.12)
npm ci
printf 'DIVVY_DEV_USER=you@example.com\nDIVVY_DEV_USERS=you@example.com,friend@example.com\n' > .dev.vars
npm run dev          # http://localhost:4321
```

Without Access settings, divvy runs in dev mode as `DIVVY_DEV_USER`; send
`x-divvy-dev-user: friend@example.com` to act as anyone in `DIVVY_DEV_USERS`.
Receipt scanning uses Workers AI, which only runs remotely; it needs
`wrangler login` and bills your account.

## Test and deploy

```sh
npm run check    # types (astro check + tsc), prettier, knip
npm test         # vitest inside workerd (domain, services, auth, API, MCP)
npm run e2e      # playwright, phone + desktop, against wrangler dev
npm run build && npm run deploy
```

Run `npm run types` after changing `wrangler.jsonc`, and `npm run format`
before committing.

## Releases

Each user-facing change adds a note with `npx changeset`. Every push to
`main` keeps one "chore: version packages" PR up to date with the next
version and its changelog; merging it tags `v<version>`, publishes a GitHub
release and deploys the Worker (when the repository has the
`CLOUDFLARE_ACCOUNT_ID` variable and `CLOUDFLARE_API_TOKEN` secret; see
`.github/workflows/release.yml`).

## Environment

Set as Worker secrets (`wrangler secret put NAME`) or, locally, in `.dev.vars`.

| Variable                   | Meaning                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| `DIVVY_ACCESS_TEAM_DOMAIN` | Cloudflare Access team domain, e.g. `house.cloudflareaccess.com`              |
| `DIVVY_ACCESS_AUD`         | Access application AUD tag                                                    |
| `DIVVY_DEV_USER`           | Dev only: act as this email when Access isn't configured                      |
| `DIVVY_DEV_USERS`          | Dev only: comma separated emails the `x-divvy-dev-user` header may pick       |
| `DIVVY_AUTH_MODE`          | `access` (default) or `picker` (anyone who can reach it picks a name on /who) |
| `DIVVY_SESSION_SECRET`     | Picker mode: cookie signing secret, at least 32 bytes                         |

Without the Access pair or `DIVVY_DEV_USER` every request fails. In picker
mode pages without a pick redirect to `/who`, where anyone who can reach the
app can pick any name or add themselves; only use it behind something else
that keeps strangers out.

Bindings (`wrangler.jsonc`): `DIVVY` (the Durable Object), `FILES` (R2),
`AI` (Workers AI), and a daily cron that bills due recurring templates.

## Connect an assistant (MCP)

1. In divvy, open Profile, then "Assistant access", and create a token. Copy
   it; it is shown once (only its hash is stored). Revoke it there anytime.
2. Register `https://<your divvy>/mcp` in your MCP client as a Streamable
   HTTP server with the header `Authorization: Bearer <token>`, plus an
   Access service token (a Service Auth policy on the Access application,
   sent as `CF-Access-Client-Id` and `CF-Access-Client-Secret`) so the request
   gets through Access. For example:

   ```sh
   claude mcp add --transport http divvy https://<your divvy>/mcp \
     --header "Authorization: Bearer divvy_..." \
     --header "CF-Access-Client-Id: ..." \
     --header "CF-Access-Client-Secret: ..."
   ```

The assistant acts as the token's owner with the same permission checks as
the app. `/mcp` is stateless (POST only), skips the app's sign-in (picker
cookie or Access JWT) and accepts nothing but a valid bearer token; requests
with another site's `Origin` are refused and bad tokens are rate limited per
client. Don't put a Bypass policy on `/mcp`.

## Architecture

```
src/
  worker.ts     Worker entry; the Divvy Durable Object runs every request
                (Astro) and the daily recur cron
  files.ts      R2 bucket access
  domain/       pure logic, no I/O
    types.ts      Cents, MemberId, ExpenseItem, Debt
    money.ts      formatCents, parseCents, allocate (largest remainder)
    split.ts      computeSplit (items, tax/tip/discount), payerErrors
    balances.ts   expenseDebts, pairwise, memberNets, simplify, drillDown
    words.ts      balance sentences ("Ana owes you $42.10")
  db/           the Durable Object's SQLite
    connection.ts the database for this request (getDb)
    rows.ts       all / one / run helpers over ctx.storage.sql
    migrate.ts    applies bundled migrations/NNN_*.sql, tracked in `migrations`
    transaction.ts transactionSync (nests)
    users.ts members.ts groups.ts expenses.ts payments.ts audit.ts  repositories
  auth/
    access.ts     Cloudflare Access JWT verification (jose, remote JWKS)
    dev.ts        dev user from env + x-divvy-dev-user header
    session.ts    request -> email -> user (created on first sign-in)
  services/     use cases; take a Ctx { db, user } and check permissions
    schemas.ts    Zod input schemas (shared with MCP); services parse input
    errors.ts     ServiceError with an HTTP status
  receipts/     scan.ts (Workers AI vision model), prompt.ts
  mcp/          the MCP server and its tools; http.ts serves /mcp
  api/http.ts   route() wrapper: JSON body, ServiceError -> { error }
  middleware.ts auth for every route except /healthz and /mcp; sets locals.ctx
  pages/        Astro pages and api/** endpoints
migrations/     plain SQL, applied in order
tests/          vitest, run in workerd; tests/worker.ts is the test Worker
e2e/            playwright
```

Money is integer cents everywhere. Shares are computed by the domain when an
expense is saved and stored in `expense_shares`; balances derive from
`expense_payers`, `expense_shares` and `payments`.
