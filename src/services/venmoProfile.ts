import { env } from "cloudflare:workers";
import { files, readFile } from "../files.ts";
import {
  getUser,
  setVenmoLookup,
  venmoAvatarPath,
  type User,
  type VenmoStatus,
} from "../db/users.ts";
import { sniffAttachment } from "./attachments.ts";
import type { Ctx } from "./context.ts";
import { invalid, notFound } from "./errors.ts";
import { parse } from "./parse.ts";
import { ProfileInput } from "./schemas.ts";
import { sharesGroup } from "../db/groups.ts";

/** Venmo photos are small; anything bigger isn't one. */
export const MAX_VENMO_PHOTO_BYTES = 1024 * 1024;
const TIMEOUT_MS = 5000;

export interface VenmoLookup {
  status: VenmoStatus;
  photo?: { bytes: Uint8Array; mime: string };
}

/** Read at most `max` bytes of a response body; undefined if it's longer. */
async function readCapped(
  res: Response,
  max: number,
): Promise<Uint8Array | undefined> {
  if (Number(res.headers.get("content-length") ?? 0) > max) return undefined;
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

const ogImage = (html: string): string | undefined =>
  /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i
    .exec(html)?.[1]
    ?.replaceAll("&amp;", "&");

/**
 * Look a username up on Venmo's public profile page, with no login: a 404
 * means it doesn't exist; a page titled "@username" with an og:image on
 * Venmo's picture host gives the photo. Anything else (blocked, a bot wall,
 * a timeout) is "unavailable".
 */
export async function lookupVenmo(
  username: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VenmoLookup> {
  try {
    const page = await fetchImpl(
      `https://account.venmo.com/u/${encodeURIComponent(username)}`,
      {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "text/html" },
      },
    );
    if (page.status === 404) return { status: "not_found" };
    if (!page.ok) return { status: "unavailable" };
    const html = new TextDecoder().decode(
      (await readCapped(page, 4 * 1024 * 1024)) ?? new Uint8Array(),
    );
    const title =
      /property=["']og:title["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1];
    if (!title?.toLowerCase().includes(`@${username.toLowerCase()}`))
      return { status: "unavailable" };
    const src = ogImage(html);
    const url = src ? new URL(src, "https://account.venmo.com") : undefined;
    // Only Venmo's own picture host; never follow the page somewhere else.
    if (
      !url ||
      url.protocol !== "https:" ||
      !/(^|\.)venmo\.com$/.test(url.hostname)
    )
      return { status: "found" };
    const img = await fetchImpl(url, {
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!img.ok) return { status: "found" };
    const bytes = await readCapped(img, MAX_VENMO_PHOTO_BYTES);
    const mime = bytes && sniffAttachment(bytes);
    return mime?.startsWith("image/") && mime !== "image/heic"
      ? { status: "found", photo: { bytes: bytes!, mime } }
      : { status: "found" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Re-check the acting user's Venmo profile and keep a copy of their photo
 * (R2 `venmo-avatars/<user id>`), so browsers never load
 * anything from Venmo. Returns the updated user.
 */
/** A 1x1 PNG the stub "finds" as a profile photo. */
const STUB_PHOTO = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const listed = (env: string | undefined, username: string) =>
  (env ?? "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .includes(username.toLowerCase());

/**
 * The real lookup, except for tests: DIVVY_VENMO_LOOKUP=off answers "couldn't
 * check" without the network; =stub (e2e only, ignored when Cloudflare Access
 * is configured, never set in production) finds the usernames in
 * DIVVY_VENMO_STUB_FOUND, misses those in DIVVY_VENMO_STUB_MISSING and can't
 * check any other.
 */
const defaultLookup: typeof lookupVenmo = async (username, f) => {
  const vars = env as unknown as Record<string, string | undefined>;
  const mode = vars.DIVVY_VENMO_LOOKUP;
  if (mode === "off") return { status: "unavailable" };
  if (mode === "stub" && !vars.DIVVY_ACCESS_AUD) {
    if (listed(vars.DIVVY_VENMO_STUB_FOUND, username))
      return {
        status: "found",
        photo: { bytes: STUB_PHOTO, mime: "image/png" },
      };
    if (listed(vars.DIVVY_VENMO_STUB_MISSING, username))
      return { status: "not_found" };
    return { status: "unavailable" };
  }
  return lookupVenmo(username, f);
};

/** Why a username can't be saved, from what its check found. */
export const venmoProblem = (username: string, status: VenmoStatus | null) =>
  status === "not_found"
    ? `We couldn't find @${username} on Venmo; check the spelling.`
    : "Couldn't check Venmo right now; try again in a minute.";

/** What the profile check found, worded for the confirm card. */
export interface VenmoPreview {
  /** Pass back to PATCH /api/me as `previewId` to save with this photo. */
  previewId: string;
  username: string;
  link: string;
  /** divvy's temporary copy of the photo, only for the user who asked. */
  photoUrl: string | null;
  /** true: the profile exists; false: Venmo says it doesn't; null: couldn't tell. */
  found: boolean | null;
  note: string | null;
}

const PREVIEWS = "venmo-previews/";
const PREVIEW_TTL_MS = 60 * 60 * 1000;

export interface PreviewMeta {
  userId: number;
  username: string;
  status: VenmoStatus;
  photo: boolean;
}

function describe(
  previewId: string,
  username: string,
  status: VenmoStatus,
  photo: boolean,
): VenmoPreview {
  return {
    previewId,
    username,
    link: `https://venmo.com/${encodeURIComponent(username)}`,
    photoUrl: photo ? `/api/me/venmo/preview/${previewId}` : null,
    found: status === "found" ? true : status === "not_found" ? false : null,
    note:
      status !== "found"
        ? venmoProblem(username, status)
        : photo
          ? null
          : "Couldn't load your Venmo photo; your link still works.",
  };
}

/** Drop previews nobody confirmed within the hour. */
async function sweepPreviews(now: number): Promise<void> {
  const { objects } = await files().list({ prefix: PREVIEWS });
  const old = objects
    .filter((o) => now - o.uploaded.getTime() > PREVIEW_TTL_MS)
    .map((o) => o.key);
  if (old.length) await files().delete(old);
}

/**
 * Look a username up before saving it, for the "Is this you?" card. Nothing
 * about the user changes; a found photo waits in R2 (an hour)
 * until PATCH /api/me saves with this preview.
 */
export async function previewVenmo(
  ctx: Ctx,
  input: { venmo: unknown },
  lookup: typeof lookupVenmo = defaultLookup,
  now = Date.now(),
): Promise<VenmoPreview> {
  const { venmo } = parse(ProfileInput, { venmo: input.venmo });
  if (!venmo) throw invalid("Enter a Venmo username");
  await sweepPreviews(now);
  const found = await lookup(venmo);
  const previewId = crypto.randomUUID();
  if (found.photo) await files().put(PREVIEWS + previewId, found.photo.bytes);
  const meta: PreviewMeta = {
    userId: ctx.user.id,
    username: venmo,
    status: found.status,
    photo: Boolean(found.photo),
  };
  await files().put(`${PREVIEWS}${previewId}.json`, JSON.stringify(meta));
  return describe(previewId, venmo, found.status, meta.photo);
}

async function previewMeta(
  ctx: Ctx,
  previewId: string,
): Promise<PreviewMeta | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(previewId)) return undefined;
  const obj = await files().get(`${PREVIEWS}${previewId}.json`);
  const meta = obj && (await obj.json<PreviewMeta>());
  return meta?.userId === ctx.user.id ? meta : undefined;
}

/**
 * Saving a username needs a check of that exact username, by this user, that
 * found the profile on Venmo; otherwise a 400 saying why.
 */
export async function requireFoundPreview(
  ctx: Ctx,
  previewId: string | undefined,
  username: string,
): Promise<PreviewMeta & { previewId: string }> {
  const meta = previewId ? await previewMeta(ctx, previewId) : undefined;
  if (!meta || meta.username.toLowerCase() !== username.toLowerCase())
    throw invalid(`Check @${username} on Venmo before saving it`);
  if (meta.status !== "found")
    throw invalid(venmoProblem(username, meta.status));
  return { ...meta, previewId: previewId! };
}

/** The temporary photo, only for the user who previewed it. */
export async function readPreviewPhoto(
  ctx: Ctx,
  previewId: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  const meta = await previewMeta(ctx, previewId);
  if (!meta?.photo) throw notFound("Photo");
  const bytes = await readFile(PREVIEWS + previewId, "Photo");
  return { bytes, mime: sniffAttachment(bytes) ?? "application/octet-stream" };
}

/**
 * Keep a confirmed preview's photo as the acting user's Venmo avatar
 * (`venmo-avatars/<user id>`) and drop the preview. Returns the avatar's key,
 * or null when the preview found no photo.
 */
export async function keepPreviewPhoto(
  ctx: Ctx,
  preview: PreviewMeta & { previewId: string },
): Promise<string | null> {
  let avatar: string | null = null;
  if (preview.photo) {
    avatar = `venmo-avatars/${ctx.user.id}`;
    await files().put(
      avatar,
      await readFile(PREVIEWS + preview.previewId, "Photo"),
    );
  }
  await files().delete([
    PREVIEWS + preview.previewId,
    `${PREVIEWS}${preview.previewId}.json`,
  ]);
  return avatar;
}

/** The confirm-card wording for what's saved (for MCP, which saves directly). */
export function savedPreview(u: User): Omit<VenmoPreview, "previewId"> {
  const { previewId: _, ...p } = describe(
    "",
    u.venmo!,
    u.venmoStatus ?? "unavailable",
    u.hasVenmoAvatar,
  );
  return {
    ...p,
    photoUrl: u.hasVenmoAvatar ? `/api/users/${u.id}/venmo-avatar` : null,
  };
}

export async function refreshVenmoPhoto(
  ctx: Ctx,
  lookup: typeof lookupVenmo = defaultLookup,
): Promise<User> {
  const user = getUser(ctx.db, ctx.user.id)!;
  if (!user.venmo) return user;
  const found = await lookup(user.venmo);
  let avatar: string | null = null;
  if (found.photo) {
    avatar = `venmo-avatars/${user.id}`;
    await files().put(avatar, found.photo.bytes);
  }
  setVenmoLookup(ctx.db, user.id, found.status, avatar);
  return getUser(ctx.db, user.id)!;
}

/** A user's stored Venmo photo, for themselves and people who share a group with them. */
export async function readVenmoAvatar(
  ctx: Ctx,
  userId: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  const other = getUser(ctx.db, userId);
  const path = other && venmoAvatarPath(ctx.db, other.id);
  if (
    !other ||
    !path ||
    (other.id !== ctx.user.id &&
      !sharesGroup(ctx.db, ctx.user.memberId, other.memberId))
  )
    throw notFound("Photo");
  const bytes = await readFile(path, "Photo");
  return { bytes, mime: sniffAttachment(bytes) ?? "application/octet-stream" };
}
