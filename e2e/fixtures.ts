import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { claimSlot, emailFor, type Name } from "./people.ts";

export { expect };

export interface Person {
  name: Name;
  email: string;
  memberId: number;
  /** API client acting as this person. */
  api: APIRequestContext;
  /** A browser page acting as this person (one per test, created on first use). */
  page(): Promise<Page>;
}

interface Fixtures {
  /** Sign in as a roommate (first call creates the account named after them). */
  as: (name: Name) => Promise<Person>;
  /** The email a roommate would sign in with, without signing them in. */
  emailOf: (name: Name) => string;
}

export const test = base.extend<Fixtures & { slot: number }>({
  slot: async ({}, use) => use(claimSlot()),

  emailOf: async ({ slot }, use) => use((name) => emailFor(name, slot)),

  as: async ({ browser, playwright, baseURL, slot }, use) => {
    const people = new Map<Name, Promise<Person>>();
    const pages: Page[] = [];
    const dialogs: string[] = [];
    const apis: APIRequestContext[] = [];

    async function signIn(name: Name): Promise<Person> {
      const email = emailFor(name, slot);
      const headers = { "x-divvy-dev-user": email };
      const api = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: headers,
      });
      apis.push(api);
      const me = await api.patch("/api/me", { data: { name } });
      expect(me.ok(), await me.text()).toBe(true);
      const { memberId } = (await me.json()) as { memberId: number };
      let page: Page | undefined;
      return {
        name,
        email,
        memberId,
        api,
        async page() {
          if (page) return page;
          const context = await browser.newContext({
            extraHTTPHeaders: headers,
          });
          page = await context.newPage();
          // Native dialogs are banned; record any so the test fails.
          page.on("dialog", (d) => {
            // beforeunload is the browser's own leave prompt for dirty forms, asked for on purpose.
            if (d.type() === "beforeunload") return;
            dialogs.push(`${d.type()}: ${d.message()}`);
            void d.dismiss();
          });
          pages.push(page);
          return page;
        },
      };
    }

    await use((name) => {
      if (!people.has(name)) people.set(name, signIn(name));
      return people.get(name)!;
    });

    for (const p of pages) await p.context().close();
    for (const a of apis) await a.dispose();
    expect(dialogs, "native dialogs are not allowed").toEqual([]);
  },
});

/** Group with the given roommates as real members, created by the first. Returns the group id. */
export async function seedGroup(
  owner: Person,
  others: Person[],
  name = "Flat",
): Promise<number> {
  const res = await owner.api.post("/api/groups", {
    data: { name, emoji: "🏠" },
  });
  expect(res.ok(), await res.text()).toBe(true);
  const { id } = (await res.json()) as { id: number };
  for (const p of others) {
    const r = await owner.api.post(`/api/groups/${id}/members`, {
      data: { email: p.email },
    });
    expect(r.ok(), await r.text()).toBe(true);
  }
  return id;
}

/** An expense `payer` paid in full, split equally among `among`. Returns its id. */
export async function seedExpense(
  by: Person,
  groupId: number,
  title: string,
  cents: number,
  payer: Person,
  among: Person[],
  date = "2026-10-01",
): Promise<number> {
  const res = await by.api.post(`/api/groups/${groupId}/expenses`, {
    data: {
      title,
      date,
      items: [
        {
          name: title,
          quantity: 1,
          unitCents: cents,
          splitType: "equal",
          split: Object.fromEntries(among.map((p) => [p.memberId, 1])),
        },
      ],
      payers: { [payer.memberId]: cents },
    },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { id: number }).id;
}

/** Wait for a client-only island to hydrate (its skeleton fallback is gone). */
export async function hydrated(page: Page): Promise<void> {
  await expect(
    page.locator('[aria-busy="true"][aria-label="Loading"]'),
  ).toHaveCount(0);
  // Server-rendered links show before their islands handle clicks.
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

/**
 * Save a Venmo username the way the app does: check it (the e2e servers'
 * stub finds the names in playwright.config.ts), then save with that check.
 */
export async function saveVenmo(p: Person, venmo: string): Promise<void> {
  const check = await p.api.post("/api/me/venmo/preview", { data: { venmo } });
  expect(check.ok(), await check.text()).toBe(true);
  const { previewId } = (await check.json()) as { previewId: string };
  const r = await p.api.patch("/api/me", { data: { venmo, previewId } });
  expect(r.ok(), await r.text()).toBe(true);
}
