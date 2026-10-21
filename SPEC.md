# divvy

Bill splitting for a household: roommates sign in, share groups, add
expenses, see exactly who owes whom, settle up. One Cloudflare Worker per
household, behind Cloudflare Access.

The feature set follows established bill splitting apps; the interface is
designed from scratch around clear balances and phones first.

## Non-negotiables

1. **Balances are never confusing.** Every balance reads as a sentence with
   names and a direction: "Ana owes you $42.10", "You owe Ben $8.00",
   "You and Cy are settled up". Every balance can be expanded into the exact
   bills and payments that make it up, with running totals that add up to the
   number shown. Never show an unsigned number or a red/green number without
   words.
2. **Mobile first.** Designed at 390x844 first, then desktop. No horizontal
   scroll at 360px. Tap targets at least 44px. No nested bottom sheets; one
   full-screen form per task with a sticky primary button. Works with the
   on-screen keyboard open (inputs never hidden behind it).
3. **Nothing silently broken.** Every user flow has a Playwright test on both
   a phone and desktop viewport. Every mutation shows success or the server's
   error message. No native alert/confirm/prompt anywhere.
4. **Money is integer cents** end to end (DB, API, domain). Splits allocate
   leftover cents so shares always sum to the total: the first rounding cent
   goes to whoever added the expense if they share it (recurring bills: the
   template's creator), else to the top payer if they share it (lowest member
   id on ties), else by largest remainder with a per-bill seed for ties.
   Dates are local `YYYY-MM-DD` strings, never UTC conversions.

## Stack

- TypeScript everywhere, strict.
- Astro 7 in server mode with `@astrojs/cloudflare` on Cloudflare Workers.
  Pages are Astro; interactive parts are React islands (expense editor,
  balances drill-down). Tailwind for styling.
- The whole app runs inside one SQLite-backed Durable Object, so every
  multi-step write is one synchronous `transactionSync`. Plain SQL migrations
  in `migrations/NNN_name.sql`, bundled and applied in order when the object
  starts, tracked in a `migrations` table.
- Uploaded files (receipts, attachments, Venmo photos) in R2; receipt scanning
  on Workers AI; recurring bills on a Cron Trigger.
- MCP server with `@modelcontextprotocol/sdk` over stateless Streamable HTTP.
- Tests: Vitest in workerd (`@cloudflare/vitest-plugin`) for domain, services
  and API, Playwright for e2e (phone + desktop) against `wrangler dev`.

## Layout (split into real modules; no god files)

```
src/
  domain/        pure logic, no I/O: money.ts (cents, allocation), split.ts
                 (equal/percent/exact/shares per item, tax/tip/discount),
                 balances.ts (per-expense debts, pairwise net, simplify),
                 recurring.ts (due dates), types.ts
  worker.ts      Worker entry and the Divvy Durable Object (fetch, recur)
  files.ts       R2 access
  db/            connection.ts, migrate.ts, one repository module per table
                 group (users.ts, groups.ts, expenses.ts, payments.ts,
                 recurring.ts)
  auth/          access.ts (Cloudflare Access JWT verification), session.ts
                 (resolve request -> user), dev.ts (local dev user)
  services/      use-case layer combining domain + db + auth checks
                 (createExpense, recordPayment, groupBalances, ...)
  pages/         Astro pages; pages/api/** JSON endpoints calling services
  components/    Astro + React components
  mcp/           server.ts and one module per tool family
  receipts/      scan.ts (Workers AI vision model, JSON schema), prompt.ts
  push/          webpush.ts (Web Push encryption and VAPID signing)
migrations/
tests/           vitest (in workerd)
e2e/             playwright
wrangler.jsonc   Worker, Durable Object, R2, AI and cron bindings
flake.nix        devShells.default
```

## Auth (Cloudflare Access)

- Every request except `/healthz` must carry a valid `Cf-Access-Jwt-Assertion`
  JWT: verify signature against `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`
  (cache keys, refetch on unknown `kid`), check `aud` equals the configured
  Access application AUD, `exp`/`nbf`, and `iss`. Use the `email` claim.
  Never trust the plain `Cf-Access-Authenticated-User-Email` header alone.
- Config: `DIVVY_ACCESS_TEAM_DOMAIN`, `DIVVY_ACCESS_AUD`. If they are unset
  the server refuses to start unless `DIVVY_DEV_USER` is set (dev/e2e only;
  then every request is that email, or the `x-divvy-dev-user` header picks
  one of `DIVVY_DEV_USERS` for multi-user tests).
- First request from a new email creates the user (display name editable,
  defaults to the email's local part). Placeholder members whose invite email
  matches are merged into the new user (their shares and payments move over).
- Sign out link: `/cdn-cgi/access/logout`.

## Data model

- users: id, email (unique), name, created.
- groups: id, name, emoji, created_by, created. group_members: group_id,
  member_id. A member is a user or a placeholder.
- members: id, user_id (nullable), name, invite_email (nullable),
  placeholder (bool). Placeholders are people without an account yet; they
  can be invited by email and claimed on first sign-in.
- expenses: id, group_id, title, date, total_cents, tax_cents, tip_cents,
  discount_cents, category (nullable), notes, created_by, created,
  updated, recurring_id (nullable), receipt_path (nullable).
  expense_items: expense_id, name, quantity, unit_cents, split_type
  (equal|percent|exact|shares), split JSON (member id -> weight/percent/cents).
  expense_payers: expense_id, member_id, cents.
  expense_shares: expense_id, member_id, cents (computed by the domain on
  save; the source of truth for balances).
- payments: id, group_id, from_member, to_member, cents, date, note,
  created_by, created.
- recurring: id, group_id, title, day_of_month (1..28), amount_cents
  (required, fixed), split JSON (member id -> weight), payer_member,
  last_month, created_by.
- audit: who changed what, when (expense/payment create/update/delete), shown
  in a group activity feed.

## Permissions

- You see a group only if you are a member. You see its expenses, payments,
  balances and activity.
- Any member can add expenses and payments in the group. An expense can be
  edited or deleted by whoever added it or anyone who paid it; a payment by
  whoever added it or either person in it (UI hides the actions for others).
- Any member can add placeholders (with an invite email only if nobody was
  invited with it before). Only the group creator can rename/delete the group,
  rename placeholders or set/change their invite email (an invite decides who
  takes over a placeholder's balance), or remove members. A member with a
  nonzero balance can't be removed.

## Screens (mobile first)

- **Home**: one sentence summary ("Overall, you're owed $120.40"), then a list
  of people with a nonzero balance across all groups, each a sentence
  ("Ana owes you $42.10") with a chevron into the drill-down. Recent activity. In
  a browser tab that can install divvy, a dismissible "Install divvy" card
  (iPhone/iPad: Share > Add to Home Screen steps); in the installed app, a
  dismissible offer to turn on notifications. Each dismissal is per device.
- **Groups**: list; group page with tabs Expenses / Balances / Members /
  Activity. Recurring bills are a collapsible section at the bottom of
  Expenses. Balances tab: each member pair as a sentence; "Simplify" toggle
  explained in one line; "Settle up" per row prefilled with the amount.
- **Balance drill-down**: for a person (or person within a group), every bill
  and payment that contributes, newest first, each with its signed effect in
  words ("Dinner: you paid $60, Ana's share $20, so Ana owes you $20") and a
  running total that ends at the headline number.
- **Add/edit expense**: one full-screen form. Title, amount or items (toggle
  "Itemize"), date, who paid (one tap = single payer of the full total;
  "Several people paid" reveals amounts with remaining), split among
  (chips, default everyone in the group), split type per item, tax/tip/
  discount (% or $), receipt scan button that fills items. Live summary of
  each person's share at the bottom, sticky Save. Validation inline.
- **Expense detail**: what it is, who paid, each person's share, items,
  receipt image if any, edit/delete for whoever may edit it.
- **Settle up / record payment**: from, to, amount (prefilled), date, note.
- **Recurring**: per group, fixed amounts only, billed automatically on their
  day (next date shown). Edit, pause, delete; a month whose bill was deleted
  can be added again by hand. Bills that change every month (electric, gas)
  are regular expenses, not recurring.
- **Profile**: name, sign out. App section: Install (when not installed),
  "Notifications on this device" (asks the browser's permission on tap;
  iPhone/iPad only once installed), and per-user switches for which pushes
  to get, on every device: New expenses, Payments. The version (package.json,
  also in GET /api/config) with "Check for updates"; when the server runs a
  newer one, "Update to X" reloads the app.

## Notifications

Web Push from the Worker with no push library: payloads encrypted with
WebCrypto (RFC 8291 aes128gcm), requests signed with a VAPID JWT (jose). The
VAPID key pair is made on first use and kept in the database, so deploys need
no extra secret. Pushes go out after the change is saved, never blocking it;
a 404/410 from the push service deletes that subscription.

- New expense: everyone with a share or a payment on it, except whoever
  added it ("Ana added Groceries", "Your share is $12.40. 🏠 House"). Bills
  from recurring templates stay quiet.
- New payment: the payer and payee, except whoever recorded it ("Ben paid
  you $20.00").
- Tapping one opens the expense (or the group for a payment) in an open
  divvy window when there is one.

Design: clean, calm, legible. System font stack, generous spacing, one accent
color, amounts always with words. Light and dark (follow system). Use
skeletons while loading, inline errors, toasts for success.

## API

JSON under `/api/**`, all requiring auth, all returning `{ error: string }`
with a 4xx on validation/permission errors. Zod for request validation.

## MCP

`POST /mcp` serves MCP to a personal access token, acting as its owner.
Tools: list_groups, list_members,
add_placeholder, add_expense (with dry_run preview, itemized or simple),
get_expense, list_expenses, delete_expense, record_payment, balances (per
person and per group, with the drill-down), list_recurring, add_recurring,
bill_recurring. Tool
descriptions tell the assistant to preview with dry_run and confirm with the
user before saving.

## Receipt scanning

A Workers AI vision model (`SCAN_MODEL`) with the photo as a data URL and a
JSON schema response format. Prompt asks for items, tax, tip, discount, total,
date as YYYY-MM-DD, and spreads discounts not tied to an item across items.
The answer is validated and converted to cents; the image goes to R2 and links
to the expense.

## Recurring

Recurring bills are fixed amounts only; a bill whose amount changes every
month is a regular expense. A daily Cron Trigger bills every unpaused
template whose day has come this month and hasn't been billed. Idempotent per
month. A month whose bill was deleted is not re-billed automatically; it can be
added again by hand (UI or MCP bill_recurring), always for the template's
amount.

## Deploy

- `wrangler.jsonc` holds no identity: the Access team domain and AUD are
  Worker secrets (`.dev.vars.example` lists them, so the Deploy to Cloudflare
  button prompts for them).
- Point-in-time recovery of the Durable Object (30 days) replaces backups.
- `devShells.default`: node 24, playwright browsers from nixpkgs
  (`playwright-driver.browsers`, pin `@playwright/test` to its version).

## Out of scope for v1

Splitwise import, analytics, share links for people without accounts,
multiple currencies, notes.
