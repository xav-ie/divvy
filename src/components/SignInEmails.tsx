import { useEffect, useRef, useState } from "react";
import { api } from "../client/api.ts";
import { copyOrSelect } from "../client/copy.ts";
import { toast } from "../client/toast.ts";
import { ConfirmButton, ErrorText, Skeleton, useAction } from "./ui.tsx";

interface Email {
  id: number;
  email: string;
  primary: boolean;
}

/** The account's sign-in emails: add one by link, remove extras, pick the primary. */
export default function SignInEmails({
  initial,
}: {
  /** Rendered by the server so the list shows without a loading flash. */
  initial?: { emails: Email[]; canLink: boolean };
}) {
  const [emails, setEmails] = useState<Email[] | null>(initial?.emails ?? null);
  const [canLink, setCanLink] = useState(initial?.canLink ?? false);
  const [link, setLink] = useState<{ url: string; expires: string } | null>(
    null,
  );
  const [copyError, setCopyError] = useState("");
  const urlRef = useRef<HTMLElement>(null);
  const load = useAction();
  const act = useAction();
  const refresh = () =>
    load.run(async () => {
      const r = await api<{ emails: Email[]; canLink: boolean }>(
        "GET",
        "/api/me/emails",
      );
      setEmails(r.emails);
      setCanLink(r.canLink);
    });
  useEffect(() => {
    if (!initial) void refresh();
  }, []);

  return (
    <section className="mt-8" aria-labelledby="sign-in-emails">
      <h2
        id="sign-in-emails"
        className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase"
      >
        Sign-in emails
      </h2>
      <div className="card space-y-4 p-4">
        <p className="text-sm text-muted">
          Signing in with any of these opens this account.
        </p>
        <ErrorText>{load.error}</ErrorText>
        {emails === null && !load.error && <Skeleton rows={1} />}
        {emails && (
          <ul className="divide-y divide-line" aria-label="Emails">
            {emails.map((e) => (
              <li key={e.id} className="space-y-2 py-3">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="break-all">{e.email}</span>
                  {e.primary && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                      Primary
                    </span>
                  )}
                </p>
                {!e.primary && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-secondary px-3 text-sm"
                      disabled={act.busy}
                      aria-label={`Make ${e.email} primary`}
                      onClick={() =>
                        act.run(async () => {
                          setEmails(
                            await api<Email[]>(
                              "PATCH",
                              `/api/me/emails/${e.id}`,
                              { primary: true },
                            ),
                          );
                          toast(`${e.email} is now your primary email`);
                        })
                      }
                    >
                      Make primary
                    </button>
                    <ConfirmButton
                      compact
                      label="Remove"
                      name={`Remove ${e.email}`}
                      question={`Remove ${e.email}? Signing in with it will no longer open this account.`}
                      confirmLabel="Remove"
                      onConfirm={async () => {
                        await api("DELETE", `/api/me/emails/${e.id}`);
                        setEmails(
                          (es) => es?.filter((x) => x.id !== e.id) ?? null,
                        );
                        toast(`Removed ${e.email}`);
                      }}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorText>{act.error}</ErrorText>
        {emails && !canLink && (
          <p className="text-sm text-muted">
            Adding emails is available with Cloudflare sign-in.
          </p>
        )}
        {canLink &&
          (link ? (
            <div className="space-y-2 rounded-xl border border-accent bg-accent-soft p-3">
              <p role="status">
                Sign in to divvy with the other email (for example in a private
                window), then open this link there. It works once, for 15
                minutes.
              </p>
              <code
                ref={urlRef}
                className="block rounded-lg border border-line bg-surface p-3 font-mono text-sm break-all select-all"
                data-testid="link-url"
              >
                {link.url}
              </code>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary flex-1"
                  onClick={async () => {
                    setCopyError("");
                    if (await copyOrSelect(link.url, urlRef.current))
                      toast("Link copied");
                    else
                      setCopyError(
                        "Couldn't copy automatically. The link is selected; copy it yourself.",
                      );
                  }}
                >
                  Copy link
                </button>
                <button
                  type="button"
                  className="btn btn-secondary flex-1"
                  onClick={() => {
                    setLink(null);
                    setCopyError("");
                  }}
                >
                  Done
                </button>
              </div>
              <ErrorText>{copyError}</ErrorText>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-secondary w-full"
              disabled={act.busy}
              onClick={() =>
                act.run(async () => {
                  const r = await api<{ path: string; expires: string }>(
                    "POST",
                    "/api/me/emails/link",
                  );
                  setLink({
                    url: `${location.origin}${r.path}`,
                    expires: r.expires,
                  });
                })
              }
            >
              Add another email
            </button>
          ))}
      </div>
    </section>
  );
}
