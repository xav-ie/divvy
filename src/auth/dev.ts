/** Header that picks the acting dev user in multi-user tests. */
export const DEV_USER_HEADER = "x-divvy-dev-user";

/**
 * Dev/e2e identity: the `x-divvy-dev-user` header if it names one of the
 * allowed emails, else the default. An unknown header email is rejected (null).
 */
export function devEmail(
  cfg: { defaultEmail: string; emails: string[] },
  request: Request,
): string | null {
  const picked = request.headers.get(DEV_USER_HEADER)?.trim().toLowerCase();
  if (!picked) return cfg.defaultEmail;
  return cfg.emails.includes(picked) ? picked : null;
}
