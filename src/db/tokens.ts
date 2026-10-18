import type { Db } from "./connection.ts";
import { all, insertedId, one, run } from "./rows.ts";

export interface ApiToken {
  id: number;
  userId: number;
  name: string;
  /** Public start of the token, e.g. `divvy_1a2b3c4d`, to tell tokens apart. */
  prefix: string;
  created: string;
  lastUsed: string | null;
  /** When it was revoked; revoked tokens never authenticate. */
  revoked: string | null;
}

const SELECT = `SELECT id, user_id AS userId, name, prefix, created, last_used AS lastUsed, revoked FROM api_tokens`;

export function insertToken(
  db: Db,
  t: { userId: number; name: string; prefix: string; hash: string },
): number {
  return insertedId(
    run(
      db,
      "INSERT INTO api_tokens (user_id, name, prefix, hash) VALUES (?, ?, ?, ?)",
      t.userId,
      t.name,
      t.prefix,
      t.hash,
    ),
  );
}

export function getToken(db: Db, id: number): ApiToken | undefined {
  return one<ApiToken>(db, `${SELECT} WHERE id = ?`, id);
}

/** A user's tokens, newest first, revoked ones included. */
export function listTokens(db: Db, userId: number): ApiToken[] {
  return all<ApiToken>(
    db,
    `${SELECT} WHERE user_id = ? ORDER BY created DESC, id DESC`,
    userId,
  );
}

/** The live (unrevoked) token with this hash. */
export function findLiveToken(db: Db, hash: string): ApiToken | undefined {
  return one<ApiToken>(
    db,
    `${SELECT} WHERE hash = ? AND revoked IS NULL`,
    hash,
  );
}

export function touchToken(db: Db, id: number): void {
  run(
    db,
    "UPDATE api_tokens SET last_used = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    id,
  );
}

export function revokeToken(db: Db, id: number): void {
  run(
    db,
    "UPDATE api_tokens SET revoked = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND revoked IS NULL",
    id,
  );
}
