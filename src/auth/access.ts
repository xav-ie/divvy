import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/** Header Cloudflare Access puts the signed identity in. */
export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

/**
 * Verifier for Cloudflare Access JWTs: signature against the team's JWKS
 * (cached by jose, refetched on an unknown `kid`), `aud`, `iss`, `exp` and
 * `nbf`. Resolves to the lowercased `email` claim; rejects otherwise.
 * `keys` is injectable for tests.
 */
export function accessVerifier(
  cfg: { teamDomain: string; aud: string },
  keys: JWTVerifyGetKey = createRemoteJWKSet(
    new URL(`https://${cfg.teamDomain}/cdn-cgi/access/certs`),
  ),
): (token: string) => Promise<string> {
  const issuer = `https://${cfg.teamDomain}`;
  return async (token) => {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: cfg.aud,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "email"],
    });
    if (typeof payload.email !== "string" || !payload.email.includes("@"))
      throw new Error("Access token has no email");
    return payload.email.trim().toLowerCase();
  };
}
