import { api } from "../client/api.ts";
import { goWithToast } from "../client/toast.ts";
import { ErrorText, useAction } from "./ui.tsx";

/** Confirm attaching the signed-in email to the link's account. */
export default function LinkEmail({
  code,
  email,
}: {
  code: string;
  email: string;
}) {
  const { busy, error, run } = useAction();
  return (
    <div className="space-y-3">
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const r = await api<{ name: string }>("POST", `/api/link/${code}`);
            goWithToast("/profile", `${email} now signs in as ${r.name}`);
          })
        }
      >
        {busy ? "Linking…" : `Link ${email}`}
      </button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
