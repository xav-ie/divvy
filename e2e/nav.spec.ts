import { expect, seedExpense, seedGroup, test } from "./fixtures.ts";

test("nav links show an icon and a label; tab pages don't repeat their name", async ({
  as,
}) => {
  const ana = await as("Ana");
  await seedGroup(ana, [], "Maple St");
  const page = await ana.page();

  for (const [href, label] of [
    ["/", "Home"],
    ["/groups", "Groups"],
    ["/profile", "Profile"],
  ] as const) {
    await page.goto(href);
    const nav = page.getByRole("navigation", { name: "Main" });
    const link = nav.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(link).toHaveAttribute("data-state", "current");
    await expect(link.locator("svg")).toHaveAttribute("aria-hidden", "true");
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    // The page still has its h1 for screen readers, but it isn't shown in the header.
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toHaveText(label);
    expect(
      await h1.evaluate((el) => el.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Back to/ })).toHaveCount(0);
  }
});

test("sub-pages read as inside their parent: back to the parent, breadcrumb, tab marked inside", async ({
  as,
}, info) => {
  const ana = await as("Ana");
  const groupId = await seedGroup(ana, [], "Maple St");
  const page = await ana.page();
  const desktop = info.project.name === "desktop";

  const expenseId = await seedExpense(ana, groupId, "Electric", 8450, ana, [
    ana,
  ]);
  await page.goto(`/expenses/${expenseId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Electric");
  const groupsTab = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Groups", exact: true });
  await expect(groupsTab).toHaveAttribute("data-state", "inside");
  await expect(groupsTab).not.toHaveAttribute("aria-current", "page");

  const back = page.getByRole("link", { name: "Back to 🏠 Maple St" });

  if (desktop) {
    // One bar everywhere: the trail sits inline after the brand, no second row.
    const brand = page.getByRole("link", { name: "divvy" });
    await expect(brand).toBeVisible();
    await expect(back).toBeHidden();
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("listitem")).toHaveText([
      /Groups/,
      /Maple St/,
      /Electric/,
    ]);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText(
      /Electric/,
    );
    const b = (await brand.boundingBox())!;
    const c = (await crumbs.boundingBox())!;
    expect(Math.abs(b.y + b.height / 2 - (c.y + c.height / 2))).toBeLessThan(4);
    // The header is as tall as on a tab page, so nothing shifts.
    const subHeight = (await page.locator("header").boundingBox())!.height;
    await page.goto("/groups");
    expect((await page.locator("header").boundingBox())!.height).toBe(
      subHeight,
    );
    await page.goBack();
    await crumbs.getByRole("link", { name: "Groups" }).click();
    await expect(page).toHaveURL(/\/groups$/);
  } else {
    // Phones: the back button names the parent and the title sits under it.
    await expect(back).toBeVisible();
    expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(back).toContainText("Maple St");
    const title = page.getByRole("heading", { level: 1 });
    const t = (await title.boundingBox())!;
    expect(t.y).toBeGreaterThan((await back.boundingBox())!.y);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
    await expect(
      page.getByRole("link", { name: "Back to Groups" }),
    ).toBeVisible();
  }
});

test("a group drill-down marks only Groups as the parent tab", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben], "Maple St");
  const page = await ana.page();
  await page.goto(`/people/${ben.memberId}?groupId=${groupId}`);
  const main = page.getByRole("navigation", { name: "Main" });
  await expect(
    main.getByRole("link", { name: "Groups", exact: true }),
  ).toHaveAttribute("data-state", "inside");
  await expect(
    main.getByRole("link", { name: "Home", exact: true }),
  ).not.toHaveAttribute("data-state", /./);
  // Phones show a back button to the group; desktop shows it in the breadcrumb.
  await expect(
    page.getByRole("link", { name: /Maple St/ }).filter({ visible: true }),
  ).toHaveCount(1);
});

test("navigation swaps pages in place, moves focus to the new heading, and still guards forms", async ({
  as,
}) => {
  const ana = await as("Ana");
  const groupId = await seedGroup(ana, [], "Maple St");
  const page = await ana.page();
  await page.goto("/");
  await page.evaluate(() => ((window as unknown as { stay: number }).stay = 1));

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Groups", exact: true })
    .click();
  await expect(page).toHaveURL(/\/groups$/);
  // Same document: no full reload between pages.
  expect(
    await page.evaluate(() => (window as unknown as { stay?: number }).stay),
  ).toBe(1);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

  // Unsaved form + browser back: the in-app question, not a silent loss.
  await page.goto(`/groups/${groupId}`);
  await page.getByRole("link", { name: "Add expense" }).click();
  await page.getByLabel("Title").fill("Half done");
  // Browser back with unsaved changes gets the browser's leave prompt.
  const prompt = page.waitForEvent("dialog");
  void page.goBack().catch(() => {});
  const d = await prompt;
  expect(d.type()).toBe("beforeunload");
  await d.accept();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}$`));
});

test("page swaps are instant: no fade and no size morph of the content", async ({
  as,
}) => {
  const ana = await as("Ana");
  await seedGroup(ana, [], "Maple St");
  const page = await ana.page();
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as unknown as { widths: number[]; anims: string[] };
    w.widths = [];
    w.anims = [];
    const tick = () => {
      w.widths.push(
        document.querySelector("main")!.getBoundingClientRect().width,
      );
      // Any running view-transition animation (fade or morph) with a real duration.
      for (const a of document.getAnimations()) {
        const pseudo = (a.effect as KeyframeEffect | null)?.pseudoElement ?? "";
        const t = a.effect?.getComputedTiming();
        if (pseudo.startsWith("::view-transition") && Number(t?.duration) > 0)
          w.anims.push(pseudo);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Groups", exact: true })
    .click();
  await expect(page).toHaveURL(/\/groups$/);
  await page.waitForTimeout(400);
  const { widths, anims } = await page.evaluate(() => {
    const w = window as unknown as { widths: number[]; anims: string[] };
    return { widths: w.widths, anims: w.anims };
  });
  expect(anims).toEqual([]);
  expect(new Set(widths).size).toBe(1);
});
