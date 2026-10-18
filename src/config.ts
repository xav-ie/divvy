import { env as workerEnv } from "cloudflare:workers";

type Vars = Record<string, string | undefined>;

export type AuthConfig =
  | { mode: "access"; teamDomain: string; aud: string }
  | { mode: "dev"; defaultEmail: string; emails: string[] }
  | { mode: "picker"; secret: string };

/** Bytes of `DIVVY_SESSION_SECRET` picker mode needs at least. */
export const SESSION_SECRET_MIN = 32;

/**
 * `DIVVY_AUTH_MODE=picker`: people pick who they are on /who, remembered in
 * a cookie signed with the `DIVVY_SESSION_SECRET` secret. Otherwise ("access", the default): Cloudflare
 * Access when `DIVVY_ACCESS_TEAM_DOMAIN` and `DIVVY_ACCESS_AUD` are set, else
 * dev mode, which requires `DIVVY_DEV_USER`. Throws when misconfigured so the
 * server refuses to start.
 */
export function authConfig(
  env: Vars = workerEnv as unknown as Vars,
): AuthConfig {
  const mode = env.DIVVY_AUTH_MODE?.trim() || "access";
  if (mode === "picker") {
    const secret = env.DIVVY_SESSION_SECRET ?? "";
    if (Buffer.byteLength(secret) < SESSION_SECRET_MIN)
      throw new Error(
        `divvy: picker mode needs a DIVVY_SESSION_SECRET of at least ${SESSION_SECRET_MIN} bytes`,
      );
    return { mode: "picker", secret };
  }
  if (mode !== "access")
    throw new Error(
      `divvy: DIVVY_AUTH_MODE must be "access" or "picker", not "${mode}"`,
    );
  const teamDomain = env.DIVVY_ACCESS_TEAM_DOMAIN?.trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const aud = env.DIVVY_ACCESS_AUD?.trim();
  if (teamDomain && aud) return { mode: "access", teamDomain, aud };
  const defaultEmail = env.DIVVY_DEV_USER?.trim().toLowerCase();
  if (!defaultEmail) {
    throw new Error(
      "divvy: set DIVVY_ACCESS_TEAM_DOMAIN and DIVVY_ACCESS_AUD (Cloudflare Access), or DIVVY_DEV_USER for local development",
    );
  }
  const emails = (env.DIVVY_DEV_USERS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return {
    mode: "dev",
    defaultEmail,
    emails: [...new Set([defaultEmail, ...emails])],
  };
}
