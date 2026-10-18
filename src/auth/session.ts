import type { AuthConfig } from "../config.ts";
import type { Db } from "../db/connection.ts";
import { getUser, type User } from "../db/users.ts";
import { signIn } from "../services/users.ts";
import { ACCESS_JWT_HEADER, accessVerifier } from "./access.ts";
import { devEmail } from "./dev.ts";
import { pickedUserId } from "./picker.ts";

/** Cookie Cloudflare Access sets on the app's domain; a fallback when the header is missing. */
export const ACCESS_COOKIE = "CF_Authorization";

/** The signed-in user (created on first sign-in) and the email this request proved. */
export interface Identity {
  user: User;
  email: string;
}

/** Resolves a request to who's signed in, or null. */
export type Authenticate = (
  request: Request,
  db: Db,
) => Promise<Identity | null>;

const signedIn = (db: Db, email: string): Identity => ({
  user: signIn(db, email),
  email: email.trim().toLowerCase(),
});

function cookie(request: Request, name: string): string | undefined {
  const c = request.headers
    .get("cookie")
    ?.split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`));
  return c?.slice(name.length + 1);
}

export function authenticator(cfg: AuthConfig): Authenticate {
  if (cfg.mode === "dev")
    return async (request, db) => {
      const email = devEmail(cfg, request);
      return email ? signedIn(db, email) : null;
    };
  if (cfg.mode === "picker")
    return async (request, db) => {
      const id = pickedUserId(request, cfg.secret);
      const user = id === null ? undefined : getUser(db, id);
      return user ? { user, email: user.email } : null;
    };
  const verify = accessVerifier(cfg);
  return async (request, db) => {
    // cloudflared forwards the header; the cookie covers requests without it.
    const token =
      request.headers.get(ACCESS_JWT_HEADER) ?? cookie(request, ACCESS_COOKIE);
    if (!token) return null;
    try {
      return signedIn(db, await verify(token));
    } catch {
      return null;
    }
  };
}
