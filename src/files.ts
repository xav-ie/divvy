import { env } from "cloudflare:workers";
import { notFound } from "./services/errors.ts";

/**
 * Uploaded files live in the R2 bucket `FILES`, keyed by the path the
 * database stores (`attachments/<uuid>`, `receipts/<uuid>.jpg`,
 * `venmo-avatars/<user id>`, `venmo-previews/<uuid>`).
 */
export const files = () => env.FILES;

/** A stored file's bytes; 404 when it's gone. */
export async function readFile(
  key: string,
  what = "File",
): Promise<Uint8Array<ArrayBuffer>> {
  const obj = await env.FILES.get(key);
  if (!obj) throw notFound(what);
  return new Uint8Array(await obj.arrayBuffer());
}
