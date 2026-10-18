import { expect, hydrated, seedExpense, seedGroup, test } from "./fixtures.ts";

const PDF = {
  name: "eversource.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.7\n%%EOF\n"),
};
// A 1x1 PNG.
const PNG = {
  name: "meter.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
};

test("attach a PDF and a photo on the expense page, open and remove", async ({
  as,
}) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const id = await seedExpense(ana, groupId, "Electric", 9000, ana, [ana, ben]);
  const page = await ana.page();
  await page.goto(`/expenses/${id}`);
  await hydrated(page);

  const section = page.getByRole("region", { name: "Attachments" });
  await expect(section).toContainText("No attachments yet.");
  await section.getByLabel("Label (optional)").fill("Eversource statement");
  await section.locator('input[type="file"]').setInputFiles([PDF]);
  await expect(page.getByRole("status")).toHaveText(
    "Attached Eversource statement",
  );
  await section.locator('input[type="file"]').setInputFiles([PNG]);
  const list = section.getByRole("list", { name: "Attachments" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list).toContainText("Eversource statement");
  await expect(list).toContainText("eversource.pdf");
  await expect(list).toContainText("meter.png");
  await expect(
    list.getByRole("link", { name: "Open Eversource statement" }),
  ).toHaveAttribute("href", /^\/api\/attachments\/\d+$/);
  await expect(list.locator("img")).toHaveCount(1);
  await expect(
    list.getByRole("link", { name: "Download Eversource statement" }),
  ).toHaveAttribute("href", /^\/api\/attachments\/\d+\?download=1$/);
  const download = page.waitForEvent("download");
  await list
    .getByRole("link", { name: "Download Eversource statement" })
    .click();
  expect((await download).suggestedFilename()).toBe("eversource.pdf");

  // Rejected types show the server's message inline.
  await section.locator('input[type="file"]').setInputFiles([
    {
      name: "evil.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("<svg onload=alert(1)>"),
    },
  ]);
  await expect(section.getByRole("alert")).toContainText(
    "evil.pdf: Attach a PDF or a photo",
  );

  // Ben sees them but can't remove what he didn't add.
  const pb = await ben.page();
  await pb.goto(`/expenses/${id}`);
  await hydrated(pb);
  await expect(
    pb.getByRole("list", { name: "Attachments" }).getByRole("listitem"),
  ).toHaveCount(2);
  await expect(pb.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  await page.reload();
  await hydrated(page);
  await page.getByRole("button", { name: "Remove meter.png" }).click();
  await page
    .getByRole("group", { name: /Remove meter.png/ })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(page.getByRole("status")).toHaveText("Removed meter.png");
  await expect(
    page.getByRole("list", { name: "Attachments" }).getByRole("listitem"),
  ).toHaveCount(1);
});

test("attach files while adding an expense", async ({ as }) => {
  const [ana, ben] = await Promise.all([as("Ana"), as("Ben")]);
  const groupId = await seedGroup(ana, [ben]);
  const page = await ana.page();
  await page.goto(`/groups/${groupId}/expenses/new`);
  await hydrated(page);
  await page.getByLabel("Title").fill("Water");
  await page.getByLabel("Amount").fill("40");
  await page.getByLabel("Attach PDF or photo").setInputFiles([PDF, PNG]);
  const attached = page.getByRole("list", { name: "Attached files" });
  await expect(attached.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Water");
  await page.getByRole("link", { name: /Water/ }).click();
  await hydrated(page);
  await expect(
    page.getByRole("list", { name: "Attachments" }).getByRole("listitem"),
  ).toHaveCount(2);
});
