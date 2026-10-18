import {
  expect,
  hydrated,
  saveVenmo,
  seedExpense,
  seedGroup,
  test,
} from "./fixtures.ts";

test("pay what you owe on Venmo, then record it", async ({ as }) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben], "Maple St");
  await seedExpense(ana, groupId, "Rent", 3000, ana, [ana, ben]);

  // Ana adds her Venmo username (with validation).
  const pa = await ana.page();
  const venmoRequests: string[] = [];
  pa.context().on("request", (r) => {
    if (/(^|\.)venmo\.com$/.test(new URL(r.url()).hostname))
      venmoRequests.push(r.url());
  });
  await pa.goto("/profile");
  await hydrated(pa);
  const venmo = pa.getByRole("form", { name: "Venmo" });
  await expect(venmo).toContainText(
    "Add your Venmo username so roommates can pay you in one tap.",
  );
  await venmo.getByLabel("Venmo username").fill("abc");
  await venmo.getByRole("button", { name: "Check" }).click();
  await expect(venmo.getByRole("alert")).toContainText(
    "Venmo usernames are 5 to 30 letters",
  );

  // A username Venmo doesn't have: the card warns and offers only Edit.
  await venmo.getByLabel("Venmo username").fill("@wrong-name");
  await venmo.getByRole("button", { name: "Check" }).click();
  const card = pa.getByRole("region", { name: "Is this you?" });
  await expect(card).toContainText("@wrong-name");
  await expect(card.getByRole("alert")).toHaveText(
    "We couldn't find @wrong-name on Venmo; check the spelling.",
  );
  await expect(card.getByRole("button", { name: /save/i })).toHaveCount(0);
  await card.getByRole("button", { name: "No, edit" }).click();
  await expect(card).toHaveCount(0);

  // One that can't be checked right now: Try again, never save.
  await venmo.getByLabel("Venmo username").fill("@cant-tell");
  await venmo.getByRole("button", { name: "Check" }).click();
  await expect(card.getByRole("alert")).toHaveText(
    "Couldn't check Venmo right now; try again in a minute.",
  );
  await expect(card.getByRole("button", { name: /save/i })).toHaveCount(0);
  await card.getByRole("button", { name: "Try again" }).click();
  await expect(card.getByRole("button", { name: "Try again" })).toBeEnabled();
  await card.getByRole("button", { name: "No, edit" }).click();
  const me = await ana.api.get("/api/me");
  expect((await me.json()).venmo).toBe(null);

  // A real one: photo (served by divvy), link, and Yes, save.
  await venmo.getByLabel("Venmo username").fill("@ana-pays");
  await venmo.getByRole("button", { name: "Check" }).click();
  await expect(card).toContainText("@ana-pays");
  await expect(card).toContainText("venmo.com/ana-pays");
  await expect(card.getByTestId("venmo-photo")).toHaveAttribute(
    "src",
    /^\/api\/me\/venmo\/preview\//,
  );
  await expect(
    card.getByRole("link", { name: "Open in Venmo" }),
  ).toHaveAttribute("href", "https://venmo.com/ana-pays");
  // Nothing in the browser went to Venmo; only a tap on the link would.
  expect(venmoRequests).toEqual([]);
  await pa
    .context()
    .route("https://venmo.com/**", (r) => r.fulfill({ body: "venmo" }));
  const opened = pa.waitForEvent("popup");
  await card.getByRole("link", { name: "Open in Venmo" }).click();
  await (await opened).close();
  expect(venmoRequests).toEqual(["https://venmo.com/ana-pays"]);

  await card.getByRole("button", { name: "Yes, save" }).click();
  await expect(pa.getByRole("status")).toHaveText(
    "Venmo username saved: @ana-pays",
  );
  const saved = pa.getByRole("region", { name: "Your Venmo" });
  await expect(saved).toContainText("@ana-pays");
  await expect(saved.getByTestId("venmo-photo")).toHaveAttribute(
    "src",
    new RegExp(`^/api/users/\\d+/venmo-avatar`),
  );
  await saved.getByRole("button", { name: "Refresh" }).click();
  await expect(saved.getByRole("button", { name: "Refresh" })).toBeEnabled();
  await expect(saved).toContainText("@ana-pays");
  expect(venmoRequests).toEqual(["https://venmo.com/ana-pays"]);

  // Ana is owed, so she never sees a pay (or request) link.
  await pa.goto("/");
  await expect(pa.getByTestId("venmo-pay")).toHaveCount(0);

  // Ben owes Ana: one tap to Venmo from home.
  const pb = await ben.page();
  await pb
    .context()
    .route("https://venmo.com/**", (r) => r.fulfill({ body: "venmo" }));
  for (const path of [
    `/groups/${groupId}?tab=balances`,
    `/people/${ana.memberId}`,
  ]) {
    await pb.goto(path);
    await expect(
      pb.getByRole("link", { name: "Pay $15.00 on Venmo" }),
    ).toHaveCount(1);
  }
  await pb.goto("/");
  await hydrated(pb);
  const pay = pb.getByRole("link", { name: "Pay $15.00 on Venmo" });
  await expect(pay).toHaveAttribute(
    "href",
    "https://venmo.com/ana-pays?txn=pay&amount=15.00&note=divvy%3A%20Maple%20St",
  );
  const popup = pb.waitForEvent("popup");
  await pay.click();
  await (await popup).close();
  const ask = pb.getByRole("group", { name: "Record the Venmo payment" });
  await expect(ask).toContainText("Did you pay Ana $15.00?");
  await ask.getByRole("button", { name: "Not yet" }).click();
  await expect(ask).toHaveCount(0);

  await pay.click();
  await pb.getByRole("button", { name: "Yes, record it" }).click();
  await expect(pb.getByRole("status")).toHaveText(
    "Recorded: you paid Ana $15.00",
  );
  await expect(pb.getByTestId("overall")).toHaveText("You're all settled up");
  await expect(pb.getByTestId("venmo-pay")).toHaveCount(0);
});

test("the settle up form offers Venmo only when you pay someone with a username", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben], "Flat");
  await seedExpense(ana, groupId, "Power", 4202, ana, [ana, ben]);
  await saveVenmo(ana, "ana-pays");

  const pb = await ben.page();
  await pb
    .context()
    .route("https://venmo.com/**", (r) => r.fulfill({ body: "venmo" }));
  await pb.goto(
    `/settle?groupId=${groupId}&from=${ben.memberId}&to=${ana.memberId}&cents=2101`,
  );
  await hydrated(pb);
  const pay = pb.getByRole("link", { name: "Pay $21.01 on Venmo" });
  await expect(pay).toHaveAttribute(
    "href",
    /amount=21\.01&note=divvy%3A%20Flat$/,
  );
  // Swapping the direction (Ana paying Ben, who has no username) hides it.
  await pb.getByLabel("From", { exact: true }).selectOption({ label: "Ana" });
  await pb.getByLabel("To", { exact: true }).selectOption({ label: "You" });
  await expect(pb.getByTestId("venmo-pay")).toHaveCount(0);
  await pb.getByLabel("From", { exact: true }).selectOption({ label: "You" });
  await pb.getByLabel("To", { exact: true }).selectOption({ label: "Ana" });

  const popup = pb.waitForEvent("popup");
  await pay.click();
  await (await popup).close();
  await pb.getByRole("button", { name: "Yes, record it" }).click();
  await expect(pb.getByRole("status")).toHaveText(
    "Recorded: You paid Ana $21.01",
  );
});

test("owing in several groups means paying group by group", async ({ as }) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const house = await seedGroup(ana, [ben], "House");
  const trip = await seedGroup(ana, [ben], "Trip");
  await seedExpense(ana, house, "Rent", 3000, ana, [ana, ben]);
  await seedExpense(ana, trip, "Gas", 1000, ana, [ana, ben]);
  await saveVenmo(ana, "ana-pays");

  const pb = await ben.page();
  await pb
    .context()
    .route("https://venmo.com/**", (r) => r.fulfill({ body: "venmo" }));
  await pb.goto("/");
  await hydrated(pb);
  await expect(
    pb.getByRole("link", { name: /^Pay \$.* on Venmo$/ }),
  ).toHaveCount(0);
  await pb.getByRole("link", { name: "Pay per group on Venmo" }).click();
  await expect(pb).toHaveURL(/\/people\/\d+/);
  await hydrated(pb);

  const pays = pb.getByRole("list", { name: "Pay on Venmo" });
  await expect(pays).toContainText("In House");
  await expect(pays).toContainText("In Trip");
  const trip5 = pays.getByRole("link", { name: "Pay $5.00 on Venmo" });
  await expect(trip5).toHaveAttribute(
    "href",
    /amount=5\.00&note=divvy%3A%20Trip$/,
  );
  const popup = pb.waitForEvent("popup");
  await trip5.click();
  await (await popup).close();
  await pb.getByRole("button", { name: "Yes, record it" }).click();
  await expect(pb.getByRole("status")).toHaveText(
    "Recorded: you paid Ana $5.00",
  );
  // Only Trip settled; House is still owed.
  await expect(pb.getByTestId("headline")).toHaveText("You owe Ana $15.00");
  await expect(
    pb.getByRole("link", { name: "Pay $15.00 on Venmo" }),
  ).toHaveCount(1);
});
