import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Interim "pick your name" sign-in for the LAN: the cookie holds a user id
 * signed with HMAC-SHA256. Anyone on the network can pick any name; it only
 * keeps honest roommates apart until Cloudflare Access is in front.
 */

export const PICKER_COOKIE = "divvy_who";
const YEAR = 365 * 24 * 60 * 60;

const mac = (userId: number, secret: string) =>
  createHmac("sha256", secret)
    .update(`divvy-who:${userId}`)
    .digest("base64url");

/** `<userId>.<mac>`. */
export function signUserId(userId: number, secret: string): string {
  return `${userId}.${mac(userId, secret)}`;
}

/** The user id if the value was signed with `secret`; null otherwise. */
export function verifyUserId(value: string, secret: string): number | null {
  const m = /^(\d+)\.([\w-]+)$/.exec(value);
  if (!m) return null;
  const userId = Number(m[1]);
  const given = Buffer.from(m[2]!);
  const want = Buffer.from(mac(userId, secret));
  return given.length === want.length && timingSafeEqual(given, want)
    ? userId
    : null;
}

/** The signed user id from the request's cookie, if valid. */
export function pickedUserId(request: Request, secret: string): number | null {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${PICKER_COOKIE}=`));
  return cookie
    ? verifyUserId(
        decodeURIComponent(cookie.slice(PICKER_COOKIE.length + 1)),
        secret,
      )
    : null;
}

/** Secure when the browser reached us over https (directly or via traefik). */
const isHttps = (request: Request) =>
  new URL(request.url).protocol === "https:" ||
  request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";

/** Set-Cookie value remembering `userId` for a year (or clearing it with null). */
export function pickerCookie(
  request: Request,
  userId: number | null,
  secret: string,
): string {
  return [
    `${PICKER_COOKIE}=${userId === null ? "" : encodeURIComponent(signUserId(userId, secret))}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${userId === null ? 0 : YEAR}`,
    ...(isHttps(request) ? ["Secure"] : []),
  ].join("; ");
}
