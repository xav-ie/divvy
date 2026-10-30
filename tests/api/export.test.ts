import { beforeAll, expect, it } from "vitest";
import { apiClient } from "./client.ts";

/**
 * The group CSV export: a member can download the whole ledger (expenses,
 * payments, net balances) with proper CSV escaping; anyone outside the
 * group gets the same 404 as every other group route.
 */
const ANA = "ana@example.com";
const BEN = "ben@example.com";
const EVE = "eve@example.com";

const call = await apiClient([ANA, BEN, EVE], {
  DIVVY_VENMO_LOOKUP: "off",
});

let gid = 0;
let anaMember = 0;
let benMember = 0;

beforeAll(async () => {
  const j = async (res: { body: any }) => res.body;
  anaMember = (await j(await call("GET", "/api/me", { as: ANA }))).memberId;
  gid = (
    await j(
      await call("POST", "/api/groups", { as: ANA, body: { name: "Flat" } }),
    )
  ).id;
  benMember = (
    await j(
      await call("POST", `/api/groups/${gid}/members`, {
        as: ANA,
        body: { email: BEN },
      }),
    )
  ).id;
  await call("POST", `/api/groups/${gid}/expenses`, {
    as: ANA,
    body: {
      items: [
        {
          name: "Groceries",
          quantity: 1,
          unitCents: 9001,
          splitType: "equal",
          split: { [anaMember]: 1, [benMember]: 1 },
        },
      ],
      payers: { [anaMember]: 9001 },
      date: "2026-10-01",
      title: "Groceries",
    },
  });
  // A comma in the title proves CSV quoting.
  await call("POST", `/api/groups/${gid}/expenses`, {
    as: BEN,
    body: {
      items: [
        {
          name: "Dinner",
          quantity: 1,
          unitCents: 5000,
          splitType: "equal",
          split: { [anaMember]: 1, [benMember]: 1 },
        },
      ],
      payers: { [benMember]: 5000 },
      date: "2026-10-02",
      title: "Dinner, out",
    },
  });
  await call("POST", `/api/groups/${gid}/payments`, {
    as: BEN,
    body: {
      fromMember: benMember,
      toMember: anaMember,
      cents: 2001,
      date: "2026-10-03",
      note: "partial settle",
    },
  });
});

it("exports expenses, payments, and balances as CSV", async () => {
  const res = await call("GET", `/api/groups/${gid}/export`, { as: BEN });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/csv");
  expect(res.headers.get("content-disposition") ?? "").toContain(
    'filename="divvy-flat-',
  );

  const csv = String(res.body);
  const lines = csv.split("\n");
  expect(lines[0]).toBe("Expenses");
  expect(lines[1]).toBe("Date,Title,Paid by,Total,Shares");
  // 9001c equal-split between two members: Ben owes the odd cent.
  expect(csv).toContain("2026-10-01,Groceries,");
  expect(csv).toContain("90.01");
  // The comma title comes back quoted and doubled-safe.
  expect(csv).toContain('"Dinner, out"');
  expect(csv).toContain("partial settle");
  expect(csv).toContain("Balances (net, positive = owed to member)");
  // Nets come straight from groupBalances: Ana paid Groceries (90.01 minus
  // her share), owes her 25.00 Dinner share, and the recorded payment —
  // divvy ledgers "from paid to" as the payee owing the payer — adds 20.01
  // against Ana. Ben is the mirror image.
  expect(csv).toContain("Ana,-0.01");
  expect(csv).toContain("Ben,0.01");
});

it("hides the export from non-members", async () => {
  const res = await call("GET", `/api/groups/${gid}/export`, { as: EVE });
  expect(res.status).toBe(404);
});
