import { files, readFile } from "../files.ts";
import { isGroupMember } from "../db/groups.ts";
import * as repo from "../db/receipts.ts";
import {
  scanReceipt,
  scanConfigured,
  ScanError,
  type ScannedReceipt,
} from "../receipts/scan.ts";
import type { Ctx } from "./context.ts";
import { notFound, ServiceError } from "./errors.ts";
import { parse } from "./parse.ts";
import { id } from "./schemas.ts";

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

const TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
} as const;

/** The image type from its magic bytes (what the vision model accepts), or undefined. */
function sniffImage(b: Uint8Array): keyof typeof TYPES | undefined {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return undefined;
}

export interface ScanResult extends ScannedReceipt {
  receiptId: number;
}

/**
 * Read a receipt photo, then keep it (R2 `receipts/`) so an expense can
 * link it. 503 when scanning isn't configured, 502 when it fails.
 */
export async function scanAndStore(
  ctx: Ctx,
  image: Uint8Array,
  scan: typeof scanReceipt = scanReceipt,
): Promise<ScanResult> {
  if (!scanConfigured())
    throw new ServiceError(
      503,
      "Receipt scanning isn't set up on this server. Enter the items by hand.",
    );
  if (image.byteLength > MAX_RECEIPT_BYTES)
    throw new ServiceError(413, "That photo is over 10 MB; try a smaller one");
  const mediaType = sniffImage(image);
  if (!mediaType)
    throw new ServiceError(400, "Upload a JPEG, PNG, WebP or GIF photo");
  let scanned: ScannedReceipt;
  try {
    scanned = await scan(image, mediaType);
  } catch (err) {
    if (err instanceof ScanError) throw new ServiceError(502, err.message);
    throw err;
  }
  const path = `receipts/${crypto.randomUUID()}.${TYPES[mediaType]}`;
  await files().put(path, image);
  const receiptId = repo.insertReceipt(ctx.db, {
    path,
    mediaType,
    uploadedBy: ctx.user.id,
  });
  return { receiptId, ...scanned };
}

/**
 * The `receiptPath` an expense in `groupId` gets for `receiptId`: undefined
 * keeps the current one, null removes it. Allowed: the acting user's own
 * upload not linked anywhere yet, or a receipt already on an expense in this
 * group.
 */
export function receiptPathFor(
  ctx: Ctx,
  groupId: number,
  receiptId: unknown,
): { receiptPath?: string | null } {
  if (receiptId === undefined) return {};
  if (receiptId === null) return { receiptPath: null };
  const r = repo.getReceipt(ctx.db, parse(id, receiptId));
  const groups = r ? repo.receiptGroups(ctx.db, r.path) : [];
  const allowed =
    r &&
    (groups.includes(groupId) ||
      (groups.length === 0 && r.uploadedBy === ctx.user.id));
  if (!r || !allowed) throw notFound("Receipt");
  return { receiptPath: r.path };
}

/** The image, for members of a group with an expense linking it (or its uploader). */
export async function readReceipt(
  ctx: Ctx,
  receiptId: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mediaType: string }> {
  const r = repo.getReceipt(ctx.db, parse(id, receiptId));
  const visible =
    r &&
    (r.uploadedBy === ctx.user.id ||
      repo
        .receiptGroups(ctx.db, r.path)
        .some((g) => isGroupMember(ctx.db, g, ctx.user.memberId)));
  if (!r || !visible) throw notFound("Receipt");
  return {
    bytes: await readFile(r.path, "Receipt"),
    mediaType: r.mediaType,
  };
}
