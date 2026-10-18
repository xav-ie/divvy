import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import {
  expect,
  hydrated,
  saveVenmo,
  seedExpense,
  seedGroup,
  test,
} from "./fixtures.ts";

const SHOTS = "/tmp/divvy-shots";

/** Elements whose box is covered by something else at a center or corner point. */
async function unclickable(page: Page): Promise<string[]> {
  const handles = await page
    .locator(
      "button:visible, a:visible, select:visible, input:visible:not([type=file]), [role=switch]:visible, textarea:visible",
    )
    .all();
  const bad: string[] = [];
  for (const h of handles) {
    await h.scrollIntoViewIfNeeded();
    const problem = await h.evaluate((el) => {
      // Center the element away from the sticky header and footer.
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const label = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`;
      const small = el instanceof HTMLInputElement && el.type === "checkbox";
      if (!small && (r.height < 44 || r.width < 44))
        return `${label} is ${Math.round(r.width)}x${Math.round(r.height)}, under 44px`;
      // Stay inside rounded corners (own radius, or a rounded card that clips it).
      const radius = Math.min(
        Math.max(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, 16),
        r.height / 2,
      );
      const inset = 2 + Math.ceil(radius * 0.3);
      const points = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + inset, r.top + inset],
        [r.right - inset, r.top + inset],
        [r.left + inset, r.bottom - inset],
        [r.right - inset, r.bottom - inset],
      ];
      for (const [x, y] of points) {
        if (y! > innerHeight || y! < 0) continue;
        const hit = document.elementFromPoint(x!, y!);
        if (
          !hit ||
          !(
            hit === el ||
            el.contains(hit) ||
            (hit as HTMLElement).closest("label")?.contains(el)
          )
        )
          return `${label} covered at (${Math.round(x!)}, ${Math.round(y!)}) by ${hit?.tagName.toLowerCase()}.${hit?.className}`;
      }
      return null;
    });
    if (problem) bad.push(problem);
  }
  return bad;
}

/** Text whose contrast against its effective background is under WCAG AA. */
/**
 * Text squeezed into a sliver: wrapped lines averaging under 6 characters, or
 * a long text in a box narrower than 6em. Catches rows where buttons crowd
 * the label down to a letter or two per line.
 */
function squeezed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    // Leaf elements only (just text inside), so one wrapped paragraph is judged as a whole.
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (
        el.children.length ||
        ["SCRIPT", "STYLE", "OPTION"].includes(el.tagName)
      )
        continue;
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (
        text.length < 4 ||
        !el.checkVisibility() ||
        el.closest("[aria-hidden=true]")
      )
        continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      // Line boxes: rects that start on a new line.
      const tops = new Set(
        [...range.getClientRects()]
          .filter((r) => r.width > 0.5)
          .map((r) => Math.round(r.top)),
      );
      const lines = tops.size;
      const width = el.getBoundingClientRect().width;
      // Visually hidden text (sr-only) is 1px wide on purpose.
      if (lines < 2 || width <= 1) continue;
      const em = parseFloat(getComputedStyle(el).fontSize);
      if (text.length / lines < 6 || (text.length > 12 && width < 6 * em))
        bad.push(
          `"${text.slice(0, 40)}" wraps into ${lines} lines in ${Math.round(width)}px`,
        );
    }
    return bad;
  });
}

function lowContrast(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    type C = [number, number, number, number];
    const parse = (s: string): C | null => {
      const m = /rgba?\(([^)]+)\)/.exec(s) ?? /color\(srgb ([^)]+)\)/.exec(s);
      if (!m) return null;
      const parts = m[1]!
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      const scale = s.startsWith("color(") ? 255 : 1;
      return [
        parts[0]! * scale,
        parts[1]! * scale,
        parts[2]! * scale,
        parts[3] ?? 1,
      ];
    };
    const over = (top: C, under: C): C => [
      top[0] * top[3] + under[0] * (1 - top[3]),
      top[1] * top[3] + under[1] * (1 - top[3]),
      top[2] * top[3] + under[2] * (1 - top[3]),
      1,
    ];
    const background = (el: Element | null): C => {
      const layers: C[] = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c[3] > 0) {
          layers.push(c);
          if (c[3] >= 1) break;
        }
      }
      let bg: C = parse(
        getComputedStyle(document.documentElement).backgroundColor,
      ) ?? [255, 255, 255, 1];
      if (bg[3] === 0)
        bg = matchMedia("(prefers-color-scheme: dark)").matches
          ? [0, 0, 0, 1]
          : [255, 255, 255, 1];
      for (const l of layers.reverse()) bg = over(l, bg);
      return bg;
    };
    const lum = (c: C) => {
      const ch = c.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
    };
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const own = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim(),
      );
      if (!own || !el.checkVisibility({ opacityProperty: true })) continue;
      // Avatars are aria-hidden but still visible text, so they're checked too.
      if (
        el.closest("[disabled], option") ||
        (el.closest("[aria-hidden=true]") && !el.classList.contains("avatar"))
      )
        continue;
      const style = getComputedStyle(el);
      const fg = parse(style.color);
      if (!fg) continue;
      const bg = background(el);
      const a = lum(over(fg, bg));
      const b = lum(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const size = parseFloat(style.fontSize);
      const large =
        size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5))
        bad.push(
          `"${el.textContent!.trim().slice(0, 40)}" ${ratio.toFixed(2)}:1`,
        );
    }
    return bad;
  });
}

test("every screen: no horizontal scroll at 360px, whole buttons clickable, legible light and dark", async ({
  as,
}, info) => {
  test.slow();
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben], "Maple St");
  await ana.api.post(`/api/groups/${groupId}/members`, {
    data: { name: "Cy" },
  });
  // A 40-character name must truncate, never widen a screen.
  await ana.api.post(`/api/groups/${groupId}/members`, {
    data: { name: "Bartholomew Maximilian Featherstonehaugh" },
  });
  // Real-world invites: long names and long emails must not squeeze member rows.
  await ana.api.post(`/api/groups/${groupId}/members`, {
    data: { name: "Rosalind Fairfax", email: "rosalind.fairfax@example.com" },
  });
  await ana.api.post(`/api/groups/${groupId}/members`, {
    data: { name: "Imogen Castella", email: "imogen.castella@example.com" },
  });
  // Rows with actions on other screens: a recurring bill and an assistant token.
  await ana.api.post(`/api/groups/${groupId}/recurring`, {
    data: {
      title: "Internet (Comcast Xfinity) for the whole apartment",
      dayOfMonth: 28,
      amountCents: 8999,
      split: { [ana.memberId]: 1, [ben.memberId]: 1 },
      payerMemberId: ana.memberId,
    },
  });
  await ana.api.post("/api/tokens", {
    data: { name: "Claude on the kitchen laptop" },
  });
  // Checked Venmo usernames: Profile shows "Your Venmo", and in Trip (where Ana
  // owes Ben) Ana gets a Pay-on-Venmo button with Ben's photo.
  await saveVenmo(ana, "rosalind-fairfax-pays");
  await saveVenmo(ben, "ana-pays");
  expect((await (await ana.api.get("/api/me")).json()).venmo).toBe(
    "rosalind-fairfax-pays",
  );
  const trip = await seedGroup(ben, [ana], "Trip");
  await seedExpense(ben, trip, "Cabin", 4200, ben, [ana, ben]);
  const expenseId = await seedExpense(
    ana,
    groupId,
    "Groceries with a rather long title for wrapping",
    12345,
    ana,
    [ana, ben],
  );
  // An attachment with a long label and file name on the expense detail.
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const up = await ana.api.post(`/api/expenses/${expenseId}/attachments`, {
    multipart: {
      file: {
        name: "eversource-statement-september-2026-account-4471.pdf",
        mimeType: "application/pdf",
        buffer: pdf,
      },
      label: "Eversource statement for September with the late fee",
    },
  });
  expect(up.ok(), await up.text()).toBe(true);
  await seedExpense(
    ben,
    groupId,
    "Internet",
    6000,
    ben,
    [ana, ben],
    "2026-10-02",
  );
  await ben.api.post(`/api/groups/${groupId}/payments`, {
    data: {
      fromMember: ben.memberId,
      toMember: ana.memberId,
      cents: 1000,
      date: "2026-10-03",
      note: "Venmo",
    },
  });

  const screens: Array<[string, string, ((p: Page) => Promise<void>)?]> = [
    ["home", "/"],
    ["groups", "/groups"],
    [
      "groups-new",
      "/groups",
      (p) => p.getByRole("button", { name: "New group" }).click(),
    ],
    ["group-expenses", `/groups/${groupId}`],
    ["group-balances", `/groups/${groupId}?tab=balances`],
    ["group-recurring", `/groups/${groupId}?recurring=1`],
    ["group-activity", `/groups/${groupId}?tab=activity`],
    ["members", `/groups/${groupId}?tab=members`],
    ["expense-new", `/groups/${groupId}/expenses/new`],
    [
      "expense-new-itemized",
      `/groups/${groupId}/expenses/new`,
      async (p) => {
        await p.getByRole("switch", { name: "Itemize" }).click();
        await p
          .getByRole("group", { name: "Item 1" })
          .getByRole("radio", { name: "By %" })
          .click();
        await p.getByRole("button", { name: "Several people paid" }).click();
      },
    ],
    ["expense-detail", `/expenses/${expenseId}`],
    ["expense-edit", `/expenses/${expenseId}/edit`],
    ["drill-down", `/people/${ben.memberId}`],
    ["drill-down-group", `/people/${ben.memberId}?groupId=${groupId}`],
    [
      "settle-up",
      `/settle?groupId=${groupId}&from=${ben.memberId}&to=${ana.memberId}&cents=5172`,
    ],
    ["recurring-new", `/groups/${groupId}/recurring/new`],
    [
      "profile",
      "/profile",
      async (p) => {
        const card = p.getByRole("region", { name: "Your Venmo" });
        await expect(card).toContainText("@rosalind-fairfax-pays");
        await expect(
          card.getByRole("link", { name: /Open in Venmo/ }),
        ).toBeVisible();
      },
    ],
    [
      "drill-down-venmo",
      `/people/${ben.memberId}?groupId=${trip}`,
      async (p) => {
        const pay = p.getByTestId("venmo-pay").first();
        await expect(
          pay.getByRole("link", { name: /Pay \$21\.00 on Venmo/ }),
        ).toBeVisible();
        const photo = pay.locator("img");
        await expect(photo).toBeVisible();
        expect(
          await photo.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
        ).toBe(true);
      },
    ],
    ["link-email", "/link/not-a-real-code"],
    ["not-found", "/groups/999999"],
  ];

  const page = await ana.page();
  // Some screens leave a form half filled; the sweep moves on regardless.
  page.on("dialog", (d) => void (d.type() === "beforeunload" && d.accept()));
  // The contrast probe itself must catch bad text.
  await page.goto("/profile");
  await page.evaluate(() =>
    document.body.insertAdjacentHTML(
      "beforeend",
      '<p style="color:#888;background:#999">faint</p>',
    ),
  );
  expect(await lowContrast(page)).toEqual([expect.stringContaining("faint")]);

  // Every avatar hue, filled and placeholder, stays AA in light and dark.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(300); // let color transitions finish
    await page.evaluate(() => {
      document.querySelector("#hue-probe")?.remove();
      const box = document.createElement("div");
      box.id = "hue-probe";
      box.className = "card";
      for (const hue of [8, 32, 88, 145, 55, 205, 238, 275, 312, 340])
        for (const ph of [false, true])
          box.insertAdjacentHTML(
            "beforeend",
            `<span aria-hidden="true" class="avatar ${ph ? "avatar-placeholder" : ""} h-9 w-9" style="--hue:${hue}">AB</span>`,
          );
      document.querySelector("main")!.appendChild(box);
    });
    expect(await lowContrast(page), `avatar hues (${scheme})`).toEqual([
      expect.stringContaining("faint"),
    ]);
  }
  await page.emulateMedia({ colorScheme: "light" });

  const phone = info.project.name === "phone";
  mkdirSync(SHOTS, { recursive: true });
  // Desktop keeps a few reference shots of the main screens.
  const desktopShots = new Set([
    "home",
    "group-balances",
    "expense-new",
    "drill-down",
    "group-expenses",
    "expense-detail",
    "members",
  ]);
  for (const [name, url, prepare] of screens) {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // Screenshots at the 390x844 design size, checks down at 360px.
      if (phone) await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url);
      await hydrated(page);
      if (prepare) await prepare(page);
      await expect(page.locator("h1")).toBeVisible();
      if (!phone && desktopShots.has(name))
        await page.screenshot({
          path: `${SHOTS}/${name}-desktop${scheme === "dark" ? "-dark" : ""}.png`,
          fullPage: true,
        });
      if (phone) {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: `${SHOTS}/${name}${scheme === "dark" ? "-dark" : ""}.png`,
          fullPage: true,
        });
        if (name === "members") {
          await page.setViewportSize({ width: 375, height: 812 });
          await page.screenshot({
            path: `${SHOTS}/${name}-375${scheme === "dark" ? "-dark" : ""}.png`,
            fullPage: true,
          });
        }
        await page.setViewportSize({ width: 360, height: 780 });
      }

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `${name} scrolls sideways`).toBeLessThanOrEqual(0);
      expect(
        await squeezed(page),
        `${name} squeezes text into a sliver`,
      ).toEqual([]);
      expect(
        await lowContrast(page),
        `${name} (${scheme}) has low-contrast text`,
      ).toEqual([]);
      if (scheme === "light")
        expect(
          await unclickable(page),
          `${name} has blocked or small controls`,
        ).toEqual([]);
    }
  }
});
