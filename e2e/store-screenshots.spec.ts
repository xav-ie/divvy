import { mkdirSync } from "node:fs";
import { expect, hydrated, seedExpense, seedGroup, test } from "./fixtures.ts";

// The install sheet's screenshots (manifest `screenshots`), from sample data.
// Skipped in the suite; regenerate with
//   DIVVY_STORE_SHOTS=1 npm run e2e -- e2e/store-screenshots.spec.ts
test.skip(!process.env.DIVVY_STORE_SHOTS, "set DIVVY_STORE_SHOTS=1");

const DIR = "public/screenshots";

test("install sheet screenshots", async ({ as }, info) => {
  const [ana, ben, cy, dee] = await Promise.all([
    as("Ana"),
    as("Ben"),
    as("Cy"),
    as("Dee"),
  ]);
  const home = await seedGroup(ana, [ben, cy, dee], "Maple St");
  await seedExpense(ana, home, "Rent", 360000, ana, [ana, ben, cy, dee]);
  await seedExpense(ben, home, "Groceries", 14275, ben, [ana, ben, cy]);
  await seedExpense(cy, home, "Internet", 8999, cy, [ana, ben, cy, dee]);
  const dinner = await seedExpense(
    ana,
    home,
    "Thai dinner",
    9640,
    ana,
    [ana, ben, dee],
    "2026-10-03",
  );
  await ben.api.post(`/api/groups/${home}/payments`, {
    data: {
      fromMember: ben.memberId,
      toMember: ana.memberId,
      cents: 25000,
      date: "2026-10-04",
    },
  });

  mkdirSync(DIR, { recursive: true });
  const page = await ana.page();
  const shot = async (url: string, name: string) => {
    await page.goto(url);
    await hydrated(page);
    await page.screenshot({
      path: `${DIR}/${name}-${info.project.name}.jpg`,
      type: "jpeg",
      quality: 85,
    });
  };
  await shot("/", "home");
  if (info.project.name === "phone") {
    await shot(`/groups/${home}`, "group");
    await shot(`/expenses/${dinner}`, "expense");
  }
});
