import { createHash, randomBytes } from "node:crypto";
import type { AuthConfig } from "../config.ts";
import type { Db } from "../db/connection.ts";
import { one, run } from "../db/rows.ts";
import { transaction } from "../db/transaction.ts";
import {
  addUserEmail,
  deleteUser,
  findUserByEmail,
  getUser,
  isEmptyUser,
  listUserEmails,
  removeUserEmail,
  setPrimaryEmail,
  type User,
  type UserEmail,
} from "../db/users.ts";
import type { Ctx } from "./context.ts";
import { conflict, forbidden, invalid, notFound } from "./errors.ts";
import { parse } from "./parse.ts";
import { id } from "./schemas.ts";

/** How long a link code works. */
export const LINK_MINUTES = 15;

const NOT_HERE =
  "Adding sign-in emails is available with Cloudflare sign-in, which verifies each email";

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

interface LinkRow {
  id: number;
  userId: number;
  expires: string;
  used: string | null;
}

/** The acting user's sign-in emails, primary first, and whether more can be added here. */
export function listEmails(
  ctx: Ctx,
  mode: AuthConfig["mode"],
): { emails: UserEmail[]; canLink: boolean } {
  return {
    emails: listUserEmails(ctx.db, ctx.user.id),
    canLink: mode === "access",
  };
}

/**
 * A single-use code, valid 15 minutes, proving the next email: open
 * /link/<code> while signed in with it. Access mode only, since Access is
 * what verifies an email.
 */
export function createLinkCode(
  ctx: Ctx,
  mode: AuthConfig["mode"],
  now = Date.now(),
): { code: string; path: string; expires: string } {
  if (mode !== "access") throw invalid(NOT_HERE);
  const code = randomBytes(24).toString("base64url");
  const expires = new Date(now + LINK_MINUTES * 60_000).toISOString();
  run(
    ctx.db,
    "INSERT INTO email_links (user_id, code_hash, expires) VALUES (?, ?, ?)",
    ctx.user.id,
    hash(code),
    expires,
  );
  return { code, path: `/link/${code}`, expires };
}

/** The live code's owner; throws a readable 400 for unknown, used or expired codes. */
function liveLink(db: Db, code: string, now: number): LinkRow {
  const row = one<LinkRow>(
    db,
    "SELECT id, user_id AS userId, expires, used FROM email_links WHERE code_hash = ?",
    hash(code),
  );
  if (!row) throw invalid("This link isn't valid. Make a new one in Profile.");
  if (row.used)
    throw invalid("This link was already used. Make a new one in Profile.");
  if (Date.parse(row.expires) <= now)
    throw invalid("This link expired. Make a new one in Profile.");
  return row;
}

/** Who a link would attach the visiting email to (for the confirm page). */
export function peekLink(
  db: Db,
  code: string,
  now = Date.now(),
): { ownerName: string } {
  return { ownerName: getUser(db, liveLink(db, code, now).userId)!.name };
}

export type LinkOutcome = "linked" | "merged" | "already";

/**
 * Attach `email` to user `userId`. If it already belongs to another account,
 * that account is merged away only when completely empty (just signed in,
 * nothing else); otherwise a 409 says why. Run inside a transaction.
 */
export function linkEmailToUser(
  db: Db,
  userId: number,
  rawEmail: string,
): LinkOutcome {
  const email = rawEmail.trim().toLowerCase();
  const holder = findUserByEmail(db, email);
  if (holder?.id === userId) return "already";
  if (holder) {
    if (!isEmptyUser(db, holder.id))
      throw conflict(
        `${email} already has its own divvy account with groups or bills, so it can't be linked. Remove it from that account first, or keep using it separately.`,
      );
    deleteUser(db, holder.id);
  }
  addUserEmail(db, userId, email);
  return holder ? "merged" : "linked";
}

/**
 * Attach the visitor's verified email to the code's owner, by the rules of
 * linkEmailToUser. Returns the owner.
 */
export function useLink(
  db: Db,
  code: string,
  verifiedEmail: string,
  mode: AuthConfig["mode"],
  now = Date.now(),
): { user: User; email: string; merged: boolean } {
  if (mode !== "access") throw invalid(NOT_HERE);
  const email = verifiedEmail.trim().toLowerCase();
  return transaction(db, () => {
    const link = liveLink(db, code, now);
    const outcome = linkEmailToUser(db, link.userId, email);
    run(
      db,
      "UPDATE email_links SET used = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      link.id,
    );
    return {
      user: getUser(db, link.userId)!,
      email,
      merged: outcome === "merged",
    };
  });
}

function ownEmail(ctx: Ctx, emailId: number): UserEmail {
  const e = listUserEmails(ctx.db, ctx.user.id).find(
    (x) => x.id === parse(id, emailId),
  );
  if (!e) throw notFound("Email");
  return e;
}

/** Remove a non-primary sign-in email from the acting user. */
export function removeEmail(ctx: Ctx, emailId: number): void {
  const e = ownEmail(ctx, emailId);
  if (e.primary)
    throw forbidden("Choose another primary email before removing this one");
  removeUserEmail(ctx.db, e.id);
}

/** Make one of the acting user's emails the primary (shown in Profile, used for invites). */
export function makePrimary(ctx: Ctx, emailId: number): UserEmail[] {
  const e = ownEmail(ctx, emailId);
  transaction(ctx.db, () => setPrimaryEmail(ctx.db, ctx.user.id, e.id));
  return listUserEmails(ctx.db, ctx.user.id);
}
