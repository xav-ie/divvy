import { describe, expect, it } from "vitest";
import { listActivity } from "../../src/services/activity.ts";
import {
  linkAttachments,
  listAttachments,
  readAttachment,
  removeAttachment,
  sanitizeFilename,
  sniffAttachment,
  uploadAttachment,
} from "../../src/services/attachments.ts";
import { ServiceError } from "../../src/services/errors.ts";
import {
  createExpense,
  deleteExpense,
  restoreExpense,
} from "../../src/services/expenses.ts";
import { createGroup } from "../../src/services/groups.ts";
import { addMember } from "../../src/services/members.ts";
import { setup, simpleExpense, type Setup } from "../helpers.ts";

const bytes = (s: string) => new TextEncoder().encode(s);
const PDF = bytes("%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n");
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
]);
const HEIC = new Uint8Array([0, 0, 0, 24, ...bytes("ftypheic"), 0, 0, 0, 0]);

const status = async (fn: () => unknown) => {
  try {
    await fn();
    return "ok";
  } catch (e) {
    if (e instanceof ServiceError) return `${e.status} ${e.message}`;
    throw e;
  }
};

function house({ as }: Setup) {
  const ana = as("ana@example.com");
  const ben = as("ben@example.com");
  const eve = as("eve@example.com");
  const g = createGroup(ana, { name: "House" });
  addMember(ana, g.id, { email: "ben@example.com" });
  const [a, b] = [ana.user.memberId, ben.user.memberId];
  const e = createExpense(
    ana,
    g.id,
    simpleExpense("Electric", 9000, a, [a, b]),
  );
  return { ana, ben, eve, g, e, a, b };
}

describe("sniffing and names", () => {
  it("trusts magic bytes, not names", () => {
    expect(sniffAttachment(PDF)).toBe("application/pdf");
    expect(sniffAttachment(PNG)).toBe("image/png");
    expect(sniffAttachment(HEIC)).toBe("image/heic");
    expect(sniffAttachment(bytes("<!doctype html><script>x</script>"))).toBe(
      undefined,
    );
    expect(
      sniffAttachment(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    ).toBe(undefined);
    expect(sniffAttachment(bytes(" %PDF-1.7"))).toBe(undefined);
  });

  it("sanitizes filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename('C:\\bills\\oct "final".pdf')).toBe(
      "oct _final_.pdf",
    );
    expect(sanitizeFilename("\u0000\u202e.pdf")).toBe("_.pdf");
    expect(sanitizeFilename("...")).toBe("attachment");
    expect(sanitizeFilename("a".repeat(300))).toHaveLength(100);
  });
});

describe("attachments", () => {
  it("attaches, lists, serves and removes with permissions", () =>
    setup(async (fx) => {
      const { ana, ben, eve, e } = house(fx);
      const pdf = await uploadAttachment(
        ana,
        {
          bytes: PDF,
          filename: "eversource.pdf",
          label: "Eversource statement",
        },
        e.id,
      );
      expect(pdf).toMatchObject({
        mime: "application/pdf",
        size: PDF.length,
        canRemove: true,
      });
      expect(listActivity(ana)[0]!.sentence).toBe(
        'You attached Eversource statement to "Electric"',
      );
      // Ben is in the group but didn't add or pay it.
      expect(
        listAttachments(ben, e.id).map((x) => [x.filename, x.canRemove]),
      ).toEqual([["eversource.pdf", false]]);
      expect(Buffer.from((await readAttachment(ben, pdf.id)).bytes)).toEqual(
        Buffer.from(PDF),
      );
      expect(
        await status(() =>
          uploadAttachment(ben, { bytes: PNG, filename: "x.png" }, e.id),
        ),
      ).toMatch(/^403 /);
      expect(await status(() => removeAttachment(ben, pdf.id))).toMatch(
        /^403 /,
      );
      expect(await status(() => listAttachments(eve, e.id))).toBe(
        "404 Group not found",
      );
      expect(await status(() => readAttachment(eve, pdf.id))).toBe(
        "404 Group not found",
      );

      expect(
        await status(() =>
          uploadAttachment(
            ana,
            { bytes: bytes("<svg/>"), filename: "evil.pdf" },
            e.id,
          ),
        ),
      ).toMatch(/^400 Attach a PDF or a photo/);
      expect(
        await status(() =>
          uploadAttachment(
            ana,
            {
              bytes: new Uint8Array(20 * 1024 * 1024 + 1),
              filename: "big.pdf",
            },
            e.id,
          ),
        ),
      ).toBe("413 That file is over 20 MB; try a smaller one");

      removeAttachment(ana, pdf.id);
      expect(listAttachments(ana, e.id)).toEqual([]);
      expect(listActivity(ana)[0]!.sentence).toBe(
        'You removed Eversource statement from "Electric"',
      );
    }));

  it("links uploads made before saving, only your own", () =>
    setup(async (fx) => {
      const { ana, ben, e, g, a } = house(fx);
      const mine = await uploadAttachment(ana, {
        bytes: PNG,
        filename: "meter.png",
      });
      const bens = await uploadAttachment(ben, {
        bytes: PNG,
        filename: "his.png",
      });
      expect(await status(() => readAttachment(ben, mine.id))).toBe(
        "404 Attachment not found",
      );
      expect(await status(() => linkAttachments(ana, e.id, [bens.id]))).toBe(
        "404 Attachment not found",
      );
      const fresh = createExpense(
        ana,
        g.id,
        simpleExpense("Water", 100, a, [a]),
      );
      linkAttachments(ana, fresh.id, [mine.id]);
      expect(listAttachments(ben, fresh.id).map((x) => x.filename)).toEqual([
        "meter.png",
      ]);
      // Already linked: can't be pulled into another expense.
      expect(await status(() => linkAttachments(ana, e.id, [mine.id]))).toBe(
        "404 Attachment not found",
      );
    }));

  it("follows the expense's soft delete and restore", () =>
    setup(async (fx) => {
      const { ana, ben, e } = house(fx);
      const img = await uploadAttachment(
        ana,
        { bytes: PNG, filename: "photo.png" },
        e.id,
      );
      // The uploader may remove their own even without edit rights later; here Ben uploads nothing.
      deleteExpense(ana, e.id);
      expect(await status(() => readAttachment(ana, img.id))).toBe(
        "404 Attachment not found",
      );
      expect(await status(() => listAttachments(ben, e.id))).toBe(
        "404 Expense not found",
      );
      restoreExpense(ana, e.id);
      expect(listAttachments(ben, e.id).map((x) => x.id)).toEqual([img.id]);
    }));
});
