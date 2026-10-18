import { expect, seedExpense, seedGroup, test } from "./fixtures.ts";

/**
 * Page-level authorization. Pages deny by rewriting to /404 (status 200 with
 * the not-found body), the middleware 401s anonymous requests in dev mode,
 * and a couple of routes redirect before any group check runs.
 */
const NOT_FOUND = "This page doesn't exist";

test("group and expense pages don't leak to non-members", async ({ as }) => {
  const [ana, cy] = await Promise.all([as("Ana"), as("Cy")]);
  const gid = await seedGroup(ana, [], "Private flat");
  const expenseId = await seedExpense(ana, gid, "Secret groceries", 5000, ana, [
    ana,
  ]);

  const paths = [
    `/groups/${gid}`,
    `/groups/${gid}/expenses/new`,
    `/groups/${gid}/recurring/new`,
    `/expenses/${expenseId}`,
    `/expenses/${expenseId}/edit`,
  ];
  for (const path of paths) {
    const res = await cy.api.get(path);
    expect(res.status(), path).toBe(404); // the /404 rewrite
    expect(await res.text(), path).toContain(NOT_FOUND);
  }
});

test("person pages are invisible to non-sharers", async ({ as }) => {
  const [ana, ben, cy] = await Promise.all([as("Ana"), as("Ben"), as("Cy")]);
  await seedGroup(ana, [ben], "Flat");
  const res = await cy.api.get(`/people/${ben.memberId}`);
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain(NOT_FOUND);
});

test("anonymous page and API requests are rejected", async ({ request }) => {
  // No header would fall back to DIVVY_DEV_USER; an unknown identity is the
  // true anonymous case in dev mode.
  const stranger = { "x-divvy-dev-user": "stranger@example.com" };
  const page = await request.get("/", { headers: stranger });
  expect(page.status()).toBe(401);
  const api = await request.get("/api/groups", { headers: stranger });
  expect(api.status()).toBe(401);
  expect((await api.json()).error).toContain("Sign in required");
});

test("/who redirects somewhere useful outside picker mode", async ({
  request,
}) => {
  const res = await request.get("/who", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe("/");
});

test("the members shim redirects to the members tab", async ({ as }) => {
  const ana = await as("Ana");
  const gid = await seedGroup(ana, [], "Flat");
  const res = await ana.api.get(`/groups/${gid}/members`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toContain(`groups/${gid}?tab=members`);
});

test("healthz stays open", async ({ request }) => {
  const res = await request.get("/healthz");
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe("ok");
});
