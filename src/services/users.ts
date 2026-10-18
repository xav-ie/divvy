import type { Db } from "../db/connection.ts";
import {
  claimPlaceholder,
  insertMember,
  mergeMember,
  placeholdersByEmail,
} from "../db/members.ts";
import { transaction } from "../db/transaction.ts";
import {
  findUserByEmail,
  getUser,
  insertUser,
  renameUser,
  setVenmo,
  setVenmoLookup,
  type User,
} from "../db/users.ts";
import type { Ctx } from "./context.ts";
import { parse } from "./parse.ts";
import { conflict } from "./errors.ts";
import { keepPreviewPhoto, requireFoundPreview } from "./venmoProfile.ts";
import { NAME_MAX, NewPersonInput, ProfileInput } from "./schemas.ts";

export type { User };

/** "ana.b@x.com" -> "Ana.b": a readable default until they set their own. */
export function defaultName(email: string): string {
  const local = email.trim().split("@")[0]!.slice(0, NAME_MAX);
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * The user for a verified email, created on first sign-in. A new user claims
 * placeholders invited with that email (taking the placeholder's name, which
 * the group already knows them by); otherwise the email's local part, capitalized.
 */
export function signIn(db: Db, rawEmail: string): User {
  const email = rawEmail.trim().toLowerCase();
  const existing = findUserByEmail(db, email);
  if (existing) return existing;
  return transaction(db, () => {
    const [first, ...rest] = placeholdersByEmail(db, email);
    const name = first?.name ?? defaultName(email);
    const userId = insertUser(db, email, name);
    if (first) {
      claimPlaceholder(db, first.id, userId, name);
      for (const p of rest) mergeMember(db, p.id, first.id);
    } else {
      insertMember(db, { userId, name, placeholder: false });
    }
    return getUser(db, userId)!;
  });
}

/**
 * Change the acting user's display name and/or Venmo username. A new Venmo
 * username is only saved with a preview (POST /api/me/venmo/preview) that
 * found it on Venmo; clearing it needs none.
 */
export async function updateProfile(
  ctx: Ctx,
  input: ProfileInput,
): Promise<User> {
  const { name, venmo, previewId } = parse(ProfileInput, input);
  const current = getUser(ctx.db, ctx.user.id)!;
  const newVenmo =
    venmo !== undefined &&
    venmo !== null &&
    venmo.toLowerCase() !== current.venmo?.toLowerCase();
  const preview = newVenmo
    ? await requireFoundPreview(ctx, previewId, venmo)
    : undefined;
  const avatar = preview ? await keepPreviewPhoto(ctx, preview) : null;
  return transaction(ctx.db, () => {
    if (name !== undefined) renameUser(ctx.db, ctx.user.id, name);
    if (venmo !== undefined && (venmo === null || newVenmo)) {
      setVenmo(ctx.db, ctx.user.id, venmo);
      if (preview) setVenmoLookup(ctx.db, ctx.user.id, preview.status, avatar);
    }
    return getUser(ctx.db, ctx.user.id)!;
  });
}

/**
 * Picker mode's "I'm new here": a new user through the normal sign-in path
 * (so placeholders invited with that email merge in), named as they typed.
 */
export function addNewPerson(db: Db, input: NewPersonInput): User {
  const { name, email } = parse(NewPersonInput, input);
  if (findUserByEmail(db, email))
    throw conflict("Someone already uses that email; pick their name instead");
  return transaction(db, () => {
    const user = signIn(db, email);
    renameUser(db, user.id, name);
    return getUser(db, user.id)!;
  });
}
