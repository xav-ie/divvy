import { useEffect, useRef, useState } from "react";
import { api } from "../client/api.ts";
import { copyOrSelect } from "../client/copy.ts";
import { toast } from "../client/toast.ts";
import {
  ConfirmButton,
  ErrorText,
  Field,
  NAME_MAX,
  Skeleton,
  useAction,
} from "./ui.tsx";

interface Token {
  id: number;
  name: string;
  prefix: string;
  created: string;
  lastUsed: string | null;
  revoked: string | null;
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/** Personal access tokens for assistants using the /mcp endpoint. */
export default function AssistantAccess({
  initial,
}: {
  /** Rendered by the server so the list shows without a loading flash. */
  initial?: Token[];
}) {
  const [tokens, setTokens] = useState<Token[] | null>(initial ?? null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copyError, setCopyError] = useState("");
  const tokenRef = useRef<HTMLElement>(null);
  const load = useAction();
  const create = useAction();
  const refresh = () =>
    load.run(async () => setTokens(await api<Token[]>("GET", "/api/tokens")));
  useEffect(() => {
    if (!initial) void refresh();
  }, []);
  const live = tokens?.filter((t) => !t.revoked) ?? [];

  return (
    <section className="mt-8" aria-labelledby="assistant-access">
      <h2
        id="assistant-access"
        className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase"
      >
        Assistant access
      </h2>
      <div className="card space-y-4 p-4">
        <div>
          <p className="text-sm text-muted">
            Let an AI assistant read and add bills as you. In its MCP settings
            use <code className="break-all">{location.origin}/mcp</code> with
            the header <code>Authorization: Bearer &lt;token&gt;</code>.
          </p>
        </div>

        {fresh ? (
          <div className="space-y-2 rounded-xl border border-accent bg-accent-soft p-3">
            <p className="font-medium" role="status">
              Copy this token now. You won't see it again.
            </p>
            <code
              ref={tokenRef}
              className="block rounded-lg border border-line bg-surface p-3 font-mono text-sm break-all select-all"
              data-testid="new-token"
            >
              {fresh}
            </code>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-primary flex-1"
                onClick={async () => {
                  setCopyError("");
                  if (await copyOrSelect(fresh, tokenRef.current))
                    toast("Token copied");
                  else
                    setCopyError(
                      "Couldn't copy automatically. The token is selected; copy it yourself.",
                    );
                }}
              >
                Copy
              </button>
              <button
                type="button"
                className="btn btn-secondary flex-1"
                onClick={() => {
                  setFresh(null);
                  setCopyError("");
                }}
              >
                Done
              </button>
            </div>
            <ErrorText>{copyError}</ErrorText>
          </div>
        ) : (
          <form
            className="space-y-3"
            aria-label="New token"
            onSubmit={(e) => {
              e.preventDefault();
              create.run(async () => {
                const t = await api<Token & { token: string }>(
                  "POST",
                  "/api/tokens",
                  { name },
                );
                setFresh(t.token);
                setName("");
                setTokens((ts) => [t, ...(ts ?? [])]);
              });
            }}
          >
            <Field
              label="Token name"
              placeholder="e.g. Claude on my laptop"
              value={name}
              required
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="btn btn-secondary w-full" disabled={create.busy}>
              {create.busy ? "Creating…" : "Create token"}
            </button>
            <ErrorText>{create.error}</ErrorText>
          </form>
        )}

        <ErrorText>{load.error}</ErrorText>
        {tokens === null && !load.error && <Skeleton rows={1} />}
        {tokens && live.length === 0 && (
          <p className="text-sm text-muted">No tokens yet.</p>
        )}
        {live.length > 0 && (
          <ul className="divide-y divide-line" aria-label="Tokens">
            {live.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="truncate font-medium">{t.name}</p>
                  <p className="text-sm text-muted">
                    <code>{t.prefix}…</code> · created {day(t.created)} ·{" "}
                    {t.lastUsed ? `last used ${day(t.lastUsed)}` : "never used"}
                  </p>
                </div>
                <ConfirmButton
                  compact
                  label="Revoke"
                  question={`Revoke "${t.name}"? Assistants using it stop working.`}
                  onConfirm={async () => {
                    await api("DELETE", `/api/tokens/${t.id}`);
                    setTokens((ts) => ts?.filter((x) => x.id !== t.id) ?? null);
                    toast("Token revoked");
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
