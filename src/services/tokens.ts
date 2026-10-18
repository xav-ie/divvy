import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/connection.ts";
import * as repo from "../db/tokens.ts";
import { getUser, type User } from "../db/users.ts";
import type { Ctx } from "./context.ts";
import { notFound } from "./errors.ts";
import { parse } from "./parse.ts";
import { id, TokenInput } from "./schemas.ts";

export type { ApiToken } from "../db/tokens.ts";

/** `divvy_<8 hex prefix>_<43 char secret>`. */
const TOKEN = /^divvy_([0-9a-f]{8})_[\w-]{43}$/;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** A new personal access token for the acting user; the plaintext is returned only here. */
export function createToken(
  ctx: Ctx,
  input: TokenInput,
): repo.ApiToken & { token: string } {
  const { name } = parse(TokenInput, input);
  const token = `divvy_${randomBytes(4).toString("hex")}_${randomBytes(32).toString("base64url")}`;
  const tokenId = repo.insertToken(ctx.db, {
    userId: ctx.user.id,
    name,
    prefix: token.slice(0, 14),
    hash: hashToken(token),
  });
  return { ...repo.getToken(ctx.db, tokenId)!, token };
}

/** The acting user's tokens (never their secrets), newest first. */
export function listTokens(ctx: Ctx): repo.ApiToken[] {
  return repo.listTokens(ctx.db, ctx.user.id);
}

/** Revoke one of the acting user's tokens; others' tokens are a 404. */
export function revokeToken(ctx: Ctx, tokenId: number): void {
  const t = repo.getToken(ctx.db, parse(id, tokenId));
  if (!t || t.userId !== ctx.user.id) throw notFound("Token");
  repo.revokeToken(ctx.db, t.id);
}

/** The user a bearer token belongs to (recording its use), or null if unknown or revoked. */
export function userForToken(db: Db, token: string): User | null {
  if (!TOKEN.test(token)) return null;
  const t = repo.findLiveToken(db, hashToken(token));
  if (!t) return null;
  repo.touchToken(db, t.id);
  return getUser(db, t.userId) ?? null;
}
