import { files, readFile } from "../files.ts";
import * as repo from "../db/attachments.ts";
import { insertAudit } from "../db/audit.ts";
import { transaction } from "../db/transaction.ts";
import type { Ctx } from "./context.ts";
import { forbidden, invalid, notFound, ServiceError } from "./errors.ts";
import { getExpense, mayEdit, requireExpense } from "./expenses.ts";
import { parse } from "./parse.ts";
import { id } from "./schemas.ts";

export type { Attachment } from "../db/attachments.ts";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "mif1",
  "msf1",
]);

/**
 * The file's type from its magic bytes (never the client's claim): PDF,
 * JPEG, PNG, WebP, GIF or HEIC; undefined for anything else, including
 * HTML and SVG whatever they're named.
 */
export function sniffAttachment(b: Uint8Array): string | undefined {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(8, 12)))
    return "image/heic";
  return undefined;
}

/** A display-safe filename: no path, no control or odd characters, at most 100. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} ._()-]+/gu, "_")
    .replace(/^[ .]+|[ .]+$/g, "")
    .slice(0, 100);
  return clean || "attachment";
}

export interface AttachmentView extends repo.Attachment {
  /** The acting user may remove it (uploader, or may edit the expense). */
  canRemove: boolean;
}

const view = (ctx: Ctx, a: repo.Attachment): AttachmentView => ({
  ...a,
  canRemove:
    a.uploadedBy === ctx.user.id ||
    (a.expenseId !== null && mayEdit(ctx, getExpense(ctx, a.expenseId))),
});

function audit(
  ctx: Ctx,
  a: { label: string | null; filename: string },
  expenseId: number,
  action: "create" | "delete",
): void {
  const e = getExpense(ctx, expenseId);
  const what = a.label || a.filename;
  insertAudit(ctx.db, {
    groupId: e.groupId,
    userId: ctx.user.id,
    action,
    entity: "attachment",
    entityId: e.id,
    summary:
      action === "create"
        ? `attached ${what} to "${e.title}"`
        : `removed ${what} from "${e.title}"`,
  });
}

/**
 * Store an uploaded file. With `expenseId` it's attached right away (needs
 * permission to edit that expense); without, it waits unlinked for the
 * expense being created (see linkAttachments).
 */
export async function uploadAttachment(
  ctx: Ctx,
  file: {
    bytes: Uint8Array<ArrayBuffer>;
    filename: string;
    label?: string | null;
  },
  expenseId?: number,
): Promise<AttachmentView> {
  if (expenseId !== undefined) {
    const e = requireExpense(ctx, expenseId);
    if (!mayEdit(ctx, e))
      throw forbidden(
        "Only the person who added this expense or someone who paid it can attach files",
      );
  }
  if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES)
    throw new ServiceError(413, "That file is over 20 MB; try a smaller one");
  if (file.bytes.byteLength === 0) throw invalid("That file is empty");
  const mime = sniffAttachment(file.bytes);
  if (!mime)
    throw invalid(
      "Attach a PDF or a photo (JPEG, PNG, WebP, GIF or HEIC); other files aren't allowed",
    );
  const label = file.label?.trim().slice(0, 100) || null;
  const path = `attachments/${crypto.randomUUID()}`;
  const sha256 = Buffer.from(
    await crypto.subtle.digest("SHA-256", file.bytes),
  ).toString("hex");
  await files().put(path, file.bytes);
  return transaction(ctx.db, () => {
    const attachmentId = repo.insertAttachment(ctx.db, {
      expenseId: expenseId ?? null,
      uploadedBy: ctx.user.id,
      filename: sanitizeFilename(file.filename),
      label,
      mime,
      size: file.bytes.byteLength,
      sha256,
      path,
    });
    const a = repo.getAttachment(ctx.db, attachmentId)!;
    if (expenseId !== undefined) audit(ctx, a, expenseId, "create");
    return view(ctx, a);
  });
}

/**
 * Attach files uploaded while an expense was being written. Only the acting
 * user's own unlinked uploads qualify, so nobody can pull in someone else's.
 */
export function linkAttachments(
  ctx: Ctx,
  expenseId: number,
  attachmentIds: unknown,
): void {
  if (attachmentIds === undefined) return;
  if (!Array.isArray(attachmentIds))
    throw invalid("attachmentIds must be a list");
  transaction(ctx.db, () => {
    for (const raw of attachmentIds) {
      const a = repo.getAttachment(ctx.db, parse(id, raw));
      if (!a || a.uploadedBy !== ctx.user.id || a.expenseId !== null)
        throw notFound("Attachment");
      repo.linkAttachment(ctx.db, a.id, expenseId);
      audit(ctx, a, expenseId, "create");
    }
  });
}

/** An expense's attachments, for members of its group. */
export function listAttachments(ctx: Ctx, expenseId: number): AttachmentView[] {
  const e = requireExpense(ctx, expenseId);
  return repo.listAttachments(ctx.db, e.id).map((a) => view(ctx, a));
}

/** The attachment if the acting user may see it (its group, or their own unlinked upload). */
function requireAttachment(ctx: Ctx, attachmentId: number): repo.Attachment {
  const a = repo.getAttachment(ctx.db, parse(id, attachmentId));
  if (!a) throw notFound("Attachment");
  if (a.expenseId === null) {
    if (a.uploadedBy !== ctx.user.id) throw notFound("Attachment");
  } else requireExpense(ctx, a.expenseId);
  return a;
}

/** Remove (soft delete) an attachment: its uploader or whoever may edit the expense. */
export function removeAttachment(ctx: Ctx, attachmentId: number): void {
  const a = requireAttachment(ctx, attachmentId);
  if (!view(ctx, a).canRemove)
    throw forbidden(
      "Only whoever uploaded it, added the expense or paid it can remove this",
    );
  transaction(ctx.db, () => {
    repo.removeAttachment(ctx.db, a.id);
    if (a.expenseId !== null) audit(ctx, a, a.expenseId, "delete");
  });
}

/** The stored bytes and how to serve them. */
export async function readAttachment(
  ctx: Ctx,
  attachmentId: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string; filename: string }> {
  const a = requireAttachment(ctx, attachmentId);
  return {
    bytes: await readFile(a.path, "Attachment"),
    mime: a.mime,
    filename: a.filename,
  };
}
